import type { TextModelInfo } from '../shared/types.ts';
import { CODEX_MODELS_URL, codexFetch } from './codexAuth.ts';

type CodexModelRecord = {
  slug?: unknown;
  display_name?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
};

const GEMINI_MODEL_ID = 'gemini';
const CODEX_FALLBACK_MODEL = 'gpt-5.5';
// The claude CLI has no model-enumeration command, so the picker offers a
// curated set. Aliases resolve to the latest model of their tier at call time.
const CLAUDE_DEFAULT_MODELS = ['fable', 'opus', 'sonnet', 'haiku'];
const CLAUDE_ALIAS_LABELS: Record<string, string> = {
  fable: 'Claude Fable',
  opus: 'Claude Opus',
  sonnet: 'Claude Sonnet',
  haiku: 'Claude Haiku'
};
const CODEX_CLIENT_VERSION = process.env.CODEX_CLIENT_VERSION || '0.0.0';
const CODEX_MODEL_CACHE_MS = 10 * 60 * 1000;
const CODEX_MODEL_TIMEOUT_MS = 1500;

let codexModelCache: { expiresAt: number; options: TextModelInfo[] } | null = null;
let codexModelRequest: Promise<TextModelInfo[]> | null = null;

function geminiTextModel(): TextModelInfo {
  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
  return {
    id: GEMINI_MODEL_ID,
    provider: 'gemini',
    model,
    label: `Gemini (${model})`,
    source: 'configured'
  };
}

function codexModelOption(model: string, label = model, source: TextModelInfo['source'] = 'codex-api'): TextModelInfo {
  return {
    id: `codex:${model}`,
    provider: 'codex',
    model,
    label: `${label} (Codex, medium)`,
    reasoningEffort: 'medium',
    source
  };
}

function fallbackCodexModel(): TextModelInfo {
  return codexModelOption(CODEX_FALLBACK_MODEL, 'GPT-5.5', 'fallback');
}

function claudeModelOption(model: string, source: TextModelInfo['source'] = 'configured'): TextModelInfo {
  return {
    id: `claude:${model}`,
    provider: 'claude',
    model,
    label: CLAUDE_ALIAS_LABELS[model] ?? `Claude (${model})`,
    source
  };
}

function claudeModelOptions(): TextModelInfo[] {
  const configured = (process.env.CLAUDE_TEXT_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const models = configured.length ? [...new Set(configured)] : CLAUDE_DEFAULT_MODELS;
  return models.map((model) => claudeModelOption(model));
}

function normalizeCodexModels(payload: unknown): TextModelInfo[] {
  const records = Array.isArray((payload as { models?: unknown }).models) ? ((payload as { models: unknown[] }).models as CodexModelRecord[]) : [];
  const seen = new Set<string>();
  const options: TextModelInfo[] = [];

  for (const record of records) {
    const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
    if (!/^gpt-/i.test(slug) || seen.has(slug)) continue;
    seen.add(slug);

    const displayName = typeof record.display_name === 'string' && record.display_name.trim() ? record.display_name.trim() : slug;
    options.push(codexModelOption(slug, displayName));
  }

  return options;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getCodexModelOptions(): Promise<TextModelInfo[]> {
  if (codexModelCache && Date.now() < codexModelCache.expiresAt) {
    return codexModelCache.options;
  }

  codexModelRequest ??= fetchCodexModelOptions()
    .then((options) => {
      codexModelCache = {
        expiresAt: Date.now() + CODEX_MODEL_CACHE_MS,
        options
      };
      return options;
    })
    .finally(() => {
      codexModelRequest = null;
    });

  try {
    return await withTimeout(codexModelRequest, CODEX_MODEL_TIMEOUT_MS);
  } catch {
    return codexModelCache?.options ?? [fallbackCodexModel()];
  }
}

async function fetchCodexModelOptions(): Promise<TextModelInfo[]> {
  try {
    const url = `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(CODEX_CLIENT_VERSION)}`;
    const response = await codexFetch(url);
    if (!response.ok) {
      throw new Error(`Codex model list failed with ${response.status}`);
    }
    const options = normalizeCodexModels(await response.json());
    return options.length ? options : [fallbackCodexModel()];
  } catch {
    return [fallbackCodexModel()];
  }
}

export async function getTextModelOptions(): Promise<TextModelInfo[]> {
  return [geminiTextModel(), ...(await getCodexModelOptions()), ...claudeModelOptions()];
}

export async function resolveTextModel(textModelId?: string): Promise<TextModelInfo> {
  if (!textModelId || textModelId === GEMINI_MODEL_ID) {
    return geminiTextModel();
  }

  if (textModelId.startsWith('codex:gpt-')) {
    const options = await getCodexModelOptions();
    const selected = options.find((option) => option.id === textModelId);
    if (selected) return selected;

    const model = textModelId.slice('codex:'.length);
    return codexModelOption(model, model, 'fallback');
  }

  if (textModelId.startsWith('claude:')) {
    const selected = claudeModelOptions().find((option) => option.id === textModelId);
    if (selected) return selected;

    const model = textModelId.slice('claude:'.length);
    if (!model) throw new Error(`Unsupported text model: ${textModelId}`);
    // The CLI validates actual availability at generation time, so saved runs
    // and manually configured models keep resolving.
    return claudeModelOption(model, 'fallback');
  }

  throw new Error(`Unsupported text model: ${textModelId}`);
}

export function legacyTextModel(): TextModelInfo {
  return {
    id: 'legacy',
    provider: 'gemini',
    model: 'unknown',
    label: 'Legacy run',
    source: 'legacy'
  };
}

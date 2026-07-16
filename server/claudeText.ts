import { spawn } from 'node:child_process';
import os from 'node:os';

export const CLAUDE_TEXT_INSTRUCTIONS = 'Generate the requested JLPT listening-practice conversations. Return only valid JSON, with no Markdown fences or explanatory text.';
const CLAUDE_STRUCTURED_INSTRUCTIONS = 'Return only valid JSON matching the requested shape, with no Markdown fences or explanatory text.';
const CLAUDE_DEFAULT_TIMEOUT_MS = 600000;

type ClaudeEnvelope = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  duration_ms?: number;
  session_id?: string;
  total_cost_usd?: number;
  usage?: unknown;
  modelUsage?: Record<string, unknown>;
};

export interface ClaudeCliInvocation {
  command: string;
  args: string[];
  cwd?: string;
}

export interface ClaudeCliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export type ClaudeCliRunner = (invocation: ClaudeCliInvocation, prompt: string, timeoutMs: number) => Promise<ClaudeCliRunResult>;

export class ClaudeCliError extends Error {
  partialOutput?: string;
  stats: unknown;

  constructor(message: string, details: { partialOutput?: string; stats: unknown; cause?: unknown }) {
    super(message);
    this.name = 'ClaudeCliError';
    this.partialOutput = details.partialOutput;
    this.stats = details.stats;
    if (details.cause) this.cause = details.cause;
  }
}

function claudeCliPath(): string {
  return process.env.CLAUDE_CLI_PATH?.trim() || 'claude';
}

function claudeTimeoutMs(): number {
  const configured = Number(process.env.CLAUDE_CLI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : CLAUDE_DEFAULT_TIMEOUT_MS;
}

function claudeFallbackModel(model: string): string {
  return model === 'sonnet' || /^claude-sonnet/i.test(model) ? 'haiku' : 'sonnet';
}

export function claudeCliInvocation(model: string, instructions: string, platform: NodeJS.Platform = process.platform): ClaudeCliInvocation {
  // The verified headless flag set: print mode, JSON envelope, all tools off,
  // no session files, no externally configured MCP servers. `--bare` must NOT
  // be added — it drops the CLI's subscription login.
  const args = [
    '-p',
    '--model', model,
    '--fallback-model', claudeFallbackModel(model),
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--system-prompt', instructions
  ];

  if (platform === 'win32') {
    const distro = process.env.CLAUDE_WSL_DISTRO?.trim();
    return {
      command: 'wsl.exe',
      // `-e` execs the CLI directly — `--` would route the joined argv through
      // the login shell, which word-splits and expands it. A neutral working
      // directory keeps project CLAUDE.md files out of the call.
      args: [...(distro ? ['-d', distro] : []), '--cd', '/tmp', '-e', claudeCliPath(), ...args]
    };
  }

  return { command: claudeCliPath(), args, cwd: os.tmpdir() };
}

const defaultClaudeCliRunner: ClaudeCliRunner = (invocation, prompt, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });

    child.stdin.on('error', () => {
      // A process that exits before consuming stdin (bad flag, missing binary)
      // must surface its own failure, not an EPIPE from this write.
    });
    child.stdin.end(prompt);
  });
};

let claudeCliRunner: ClaudeCliRunner = defaultClaudeCliRunner;

export function configureClaudeCliRunnerForTests(runner?: ClaudeCliRunner): void {
  claudeCliRunner = runner ?? defaultClaudeCliRunner;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const firstObject = withoutFence.indexOf('{');
  const lastObject = withoutFence.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    return withoutFence.slice(firstObject, lastObject + 1);
  }
  return withoutFence;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as Partial<T>;
}

function parseEnvelope(stdout: string): ClaudeEnvelope | undefined {
  const trimmed = stdout.trim();
  const candidates = [trimmed, trimmed.slice(trimmed.indexOf('{'))];
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as ClaudeEnvelope;
    } catch {
      continue;
    }
  }
  return undefined;
}

function outputTokensOf(usage: unknown): number {
  const record = usage && typeof usage === 'object' ? usage as Record<string, unknown> : {};
  return typeof record.outputTokens === 'number' && Number.isFinite(record.outputTokens) ? record.outputTokens : 0;
}

function resolvedModelFromEnvelope(envelope: ClaudeEnvelope, requestedModel: string): string | undefined {
  // `modelUsage` can list tiny auxiliary calls alongside the serving model, so
  // never trust key order: prefer entries in the requested model's family,
  // then the entry that produced the most output.
  const entries = Object.entries(envelope.modelUsage ?? {});
  if (!entries.length) return undefined;
  const family = requestedModel.replace(/^claude-/i, '').split('-')[0].trim().toLowerCase();
  const familyMatches = family ? entries.filter(([id]) => id.toLowerCase().includes(family)) : [];
  const candidates = familyMatches.length ? familyMatches : entries;
  return candidates.reduce((best, entry) => outputTokensOf(entry[1]) > outputTokensOf(best[1]) ? entry : best)[0];
}

function envelopeStats(envelope: ClaudeEnvelope | undefined, requestedModel: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { result: _result, ...rest } = envelope ?? {};
  return compactObject({
    ...rest,
    transport: 'claude-cli',
    requestedModel,
    resolvedModel: envelope ? resolvedModelFromEnvelope(envelope, requestedModel) : undefined,
    ...extra
  });
}

function tail(text: string, maxLength = 2000): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(-maxLength) : trimmed;
}

export async function generateClaudeStructuredJson(
  prompt: string,
  model: string,
  instructions = CLAUDE_STRUCTURED_INSTRUCTIONS,
  timeoutMs = claudeTimeoutMs()
): Promise<{ parsed: unknown; output: string; stats?: unknown }> {
  const invocation = claudeCliInvocation(model, instructions);

  let run: ClaudeCliRunResult;
  try {
    run = await claudeCliRunner(invocation, prompt, timeoutMs);
  } catch (error) {
    throw new ClaudeCliError(`Failed to launch the Claude CLI (${invocation.command}): ${error instanceof Error ? error.message : String(error)}`, {
      stats: envelopeStats(undefined, model),
      cause: error
    });
  }

  const envelope = parseEnvelope(run.stdout);

  if (run.timedOut) {
    throw new ClaudeCliError(`Claude CLI call timed out after ${timeoutMs}ms.`, {
      partialOutput: tail(run.stdout, 20000),
      stats: envelopeStats(envelope, model, { timedOut: true, stderrTail: tail(run.stderr) })
    });
  }

  if (envelope?.is_error) {
    const message = envelope.result?.trim() || `Claude CLI reported an error (${envelope.subtype ?? 'unknown'}).`;
    throw new ClaudeCliError(`Claude generation failed: ${message}`, {
      partialOutput: envelope.result,
      stats: envelopeStats(envelope, model, { stderrTail: tail(run.stderr) })
    });
  }

  if (run.exitCode !== 0) {
    const message = envelope?.result?.trim() || tail(run.stderr) || tail(run.stdout) || 'no output';
    throw new ClaudeCliError(`Claude CLI exited with code ${run.exitCode ?? 'unknown'}: ${message}`, {
      partialOutput: tail(run.stdout, 20000),
      stats: envelopeStats(envelope, model, { exitCode: run.exitCode, stderrTail: tail(run.stderr) })
    });
  }

  if (!envelope) {
    throw new ClaudeCliError('Claude CLI returned an unparseable response envelope.', {
      partialOutput: tail(run.stdout, 20000),
      stats: envelopeStats(undefined, model, { stderrTail: tail(run.stderr) })
    });
  }

  const content = envelope.result ?? '';
  if (!content.trim()) {
    throw new ClaudeCliError('Claude returned an empty generation response.', {
      stats: envelopeStats(envelope, model, { stderrTail: tail(run.stderr) })
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(content));
  } catch (error) {
    // Keep the ClaudeCliError contract even here: the audit needs the actual
    // (possibly truncated) model output and the usage stats, not a bare SyntaxError.
    throw new ClaudeCliError(`Claude returned a response that is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      partialOutput: content,
      stats: envelopeStats(envelope, model, { stderrTail: tail(run.stderr) }),
      cause: error
    });
  }

  return {
    parsed,
    output: content,
    stats: envelopeStats(envelope, model)
  };
}

export async function generateClaudeConversationJson(prompt: string, model: string, timeoutMs?: number): Promise<{ parsed: unknown; output: string; stats?: unknown }> {
  return generateClaudeStructuredJson(prompt, model, CLAUDE_TEXT_INSTRUCTIONS, timeoutMs);
}

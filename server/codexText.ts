import { CODEX_API_URL } from 'gpt-oauth-client';
import { codexFetch } from './codexAuth.ts';

type CodexStreamEvent = {
  type?: string;
  delta?: string;
  text?: string;
  response?: {
    id?: string;
    object?: string;
    created_at?: number;
    status?: string;
    completed_at?: number | null;
    error?: { message?: string } | null;
    incomplete_details?: unknown;
    model?: string;
    output?: Array<{
      type?: string;
      content?: Array<string | { type?: string; text?: string }>;
    }>;
    reasoning?: unknown;
    service_tier?: string;
    text?: unknown;
    usage?: unknown;
    metadata?: unknown;
  };
  part?: {
    type?: string;
    text?: string;
  };
  item?: {
    type?: string;
    content?: Array<string | { type?: string; text?: string }>;
  };
};

type CodexContent = Array<string | { type?: string; text?: string }>;

export const CODEX_TEXT_INSTRUCTIONS = 'Generate the requested JLPT listening-practice conversations. Return only valid JSON, with no Markdown fences or explanatory text.';

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

export async function generateCodexConversationJson(prompt: string, model: string): Promise<{ parsed: unknown; output: string; stats?: unknown }> {
  const response = await codexFetch(CODEX_API_URL, {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    body: JSON.stringify({
      model,
      store: false,
      stream: true,
      instructions: CODEX_TEXT_INSTRUCTIONS,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }]
        }
      ],
      include: ['reasoning.encrypted_content'],
      text: { verbosity: 'medium' },
      reasoning: { effort: 'medium', summary: 'auto' }
    })
  });

  const streamText = await response.text();
  if (!response.ok) {
    throw new Error(`Codex generation failed with ${response.status}: ${streamText}`);
  }

  const parsedStream = parseCodexStream(streamText);
  const content = parsedStream.content;
  if (!content.trim()) {
    throw new Error('Codex returned an empty generation response.');
  }

  return {
    parsed: JSON.parse(stripJsonFences(content)),
    output: content,
    stats: parsedStream.stats ?? { requestedModel: model }
  };
}

function contentText(content?: CodexContent): string {
  return content
    ?.map((part) => {
      if (typeof part === 'string') return part;
      return part.type === 'text' || part.type === 'output_text' ? part.text ?? '' : '';
    })
    .join('') ?? '';
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as Partial<T>;
}

function codexResponseStats(response: CodexStreamEvent['response'], streamEventCount: number): unknown {
  if (!response) return { streamEventCount };
  return compactObject({
    id: response.id,
    object: response.object,
    status: response.status,
    model: response.model,
    createdAt: response.created_at,
    completedAt: response.completed_at,
    serviceTier: response.service_tier,
    usage: response.usage,
    reasoning: response.reasoning,
    text: response.text,
    metadata: response.metadata,
    incompleteDetails: response.incomplete_details,
    streamEventCount
  });
}

function parseCodexStream(streamText: string): { content: string; stats?: unknown } {
  let deltaText = '';
  let doneText = '';
  let stats: unknown;
  let streamEventCount = 0;

  for (const line of streamText.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;

    let event: CodexStreamEvent;
    try {
      event = JSON.parse(data) as CodexStreamEvent;
    } catch {
      continue;
    }
    streamEventCount += 1;

    if (event.response?.error?.message) {
      throw new Error(event.response.error.message);
    }

    if (event.type === 'response.output_text.delta' && event.delta) {
      deltaText += event.delta;
    } else if (event.type === 'response.output_text.done' && typeof event.text === 'string') {
      doneText = event.text;
    } else if (event.type === 'response.content_part.done' && event.part?.type === 'output_text' && typeof event.part.text === 'string') {
      doneText = event.part.text;
    } else if (event.type === 'response.output_item.done' && event.item?.type === 'message') {
      doneText = contentText(event.item.content) || doneText;
    } else if ((event.type === 'response.done' || event.type === 'response.completed') && Array.isArray(event.response?.output)) {
      const message = event.response.output.find((item) => item.type === 'message');
      doneText = contentText(message?.content) || doneText;
      stats = codexResponseStats(event.response, streamEventCount);
    }
  }

  return {
    content: doneText || deltaText,
    stats: stats ?? { streamEventCount }
  };
}

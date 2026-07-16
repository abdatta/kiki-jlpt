import { GoogleGenAI } from '@google/genai';
import mime from 'mime';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationLine, PracticeConversation } from '../shared/types.ts';
import { runAudioDir } from './storage.ts';

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

interface GeminiInlineAudio {
  mimeType?: string;
  data?: string;
}

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env[name] ?? '').trim().toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockDelayMs(): number {
  const minimumMs = 5000;
  const randomJitterMs = Math.floor(Math.random() * 3001);
  return minimumMs + randomJitterMs;
}

function mockAudioDurationSeconds(conversation: PracticeConversation): number {
  const spokenCharacterCount = conversation.text.reduce((sum, line) => sum + line.japanese.length, 0);
  return Math.max(18, Math.min(55, Math.round(spokenCharacterCount / 4)));
}

function wavHeader(dataLength: number, sampleRate: number, bitsPerSample: number, numChannels: number): Buffer {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function mockWavBuffer(durationSeconds: number): Buffer {
  const sampleRate = 8000;
  const bitsPerSample = 16;
  const numChannels = 1;
  const dataLength = durationSeconds * sampleRate * numChannels * bitsPerSample / 8;
  return Buffer.concat([wavHeader(dataLength, sampleRate, bitsPerSample, numChannels), Buffer.alloc(dataLength)]);
}

async function generateMockConversationAudio(runId: string, conversation: PracticeConversation, jobToken: string): Promise<{ fileName: string; filePath: string }> {
  await sleep(mockDelayMs());

  const failAt = Number(process.env.MOCK_TTS_FAIL_AT);
  if (Number.isInteger(failAt) && failAt === conversation.number) {
    throw new Error(`Mock TTS failure for conversation ${conversation.number}.`);
  }

  const outputDir = runAudioDir(runId);
  await mkdir(outputDir, { recursive: true });
  const fileName = `${conversation.id}.mock.wav`;
  const filePath = path.join(outputDir, fileName);
  const temporaryPath = path.join(outputDir, `.${conversation.id}.${jobToken}.mock.wav.tmp`);
  await writeFile(temporaryPath, mockWavBuffer(mockAudioDurationSeconds(conversation)));
  await rename(temporaryPath, filePath);
  return { fileName, filePath };
}

function getAi(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Create a .env or set the variable before generating.');
  }
  return new GoogleGenAI({ apiKey });
}

async function responseText(response: unknown): Promise<string> {
  const typed = response as {
    text?: string | (() => string | Promise<string>);
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (typeof typed.text === 'string') return typed.text;
  if (typeof typed.text === 'function') return await typed.text();

  return typed.candidates?.flatMap((candidate) => candidate.content?.parts?.map((part) => part.text ?? '') ?? []).join('\n') ?? '';
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

function extractGeminiStats(response: unknown, model: string): unknown {
  const typed = response as {
    usageMetadata?: unknown;
    modelVersion?: unknown;
    responseId?: unknown;
    promptFeedback?: unknown;
    candidates?: Array<{
      index?: unknown;
      finishReason?: unknown;
      safetyRatings?: unknown;
      citationMetadata?: unknown;
      groundingMetadata?: unknown;
    }>;
  };

  return compactObject({
    model,
    responseId: typed.responseId,
    modelVersion: typed.modelVersion,
    usageMetadata: typed.usageMetadata,
    promptFeedback: typed.promptFeedback,
    candidates: typed.candidates?.map((candidate) => compactObject({
      index: candidate.index,
      finishReason: candidate.finishReason,
      safetyRatings: candidate.safetyRatings,
      citationMetadata: candidate.citationMetadata,
      groundingMetadata: candidate.groundingMetadata
    }))
  });
}

export async function generateGeminiStructuredJson(
  prompt: string,
  model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
  temperature = 0.2,
  timeoutMs?: number
): Promise<{ parsed: unknown; output: string; stats?: unknown }> {
  const ai = getAi();

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature,
      responseMimeType: 'application/json',
      ...(timeoutMs ? { httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } } } : {})
    }
  } as never);

  const text = await responseText(response);
  if (!text.trim()) {
    throw new Error('Gemini returned an empty generation response.');
  }

  return {
    parsed: JSON.parse(stripJsonFences(text)),
    output: text,
    stats: extractGeminiStats(response, model)
  };
}

export async function generateConversationJson(prompt: string, timeoutMs?: number): Promise<{ parsed: unknown; output: string; stats?: unknown }> {
  return generateGeminiStructuredJson(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', 0.75, timeoutMs);
}

function parseMimeType(mimeType: string): WavConversionOptions {
  const [fileType, ...params] = mimeType.split(';').map((segment) => segment.trim());
  const [, format] = fileType.split('/');

  const options: Partial<WavConversionOptions> = {
    numChannels: 1,
    sampleRate: 24000,
    bitsPerSample: 16
  };

  if (format?.startsWith('L')) {
    const bits = Number.parseInt(format.slice(1), 10);
    if (Number.isFinite(bits)) options.bitsPerSample = bits;
  }

  for (const param of params) {
    const [key, value] = param.split('=').map((segment) => segment.trim());
    if (key === 'rate') {
      const sampleRate = Number.parseInt(value, 10);
      if (Number.isFinite(sampleRate)) options.sampleRate = sampleRate;
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
  const { numChannels, sampleRate, bitsPerSample } = options;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

function convertToWav(rawData: string, mimeType: string): Buffer {
  const audioBuffer = Buffer.from(rawData, 'base64');
  const wavHeader = createWavHeader(audioBuffer.length, parseMimeType(mimeType));
  return Buffer.concat([wavHeader, audioBuffer]);
}

function extractInlineAudio(response: unknown): GeminiInlineAudio | undefined {
  const typed = response as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: GeminiInlineAudio }> } }>;
  };

  return typed.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data)?.inlineData;
}

function audioBufferForInlineData(inlineData: GeminiInlineAudio): { extension: string; buffer: Buffer } {
  const mimeType = inlineData.mimeType || '';
  const normalizedMimeType = mimeType.split(';')[0].trim();
  const extension = mime.getExtension(normalizedMimeType);

  if (extension && normalizedMimeType !== 'audio/L16' && normalizedMimeType !== 'audio/pcm') {
    return {
      extension,
      buffer: Buffer.from(inlineData.data || '', 'base64')
    };
  }

  return {
    extension: 'wav',
    buffer: convertToWav(inlineData.data || '', mimeType)
  };
}

function transcriptLine(line: ConversationLine): string {
  return `${line.speaker}: [${line.tags.join(', ')}] ${line.japanese}`;
}

export function buildTtsPrompt(conversation: PracticeConversation): string {
  return `## Scene:
${conversation.scene}

## Sample Context:
${conversation.sampleContext}

## Transcript:
${conversation.text.map(transcriptLine).join('\n')}`;
}

export async function generateConversationAudio(runId: string, conversation: PracticeConversation, jobToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`): Promise<{ fileName: string; filePath: string }> {
  if (envFlag('MOCK_TTS_AUDIO')) {
    return generateMockConversationAudio(runId, conversation, jobToken);
  }

  const ai = getAi();
  const model = process.env.GEMINI_TTS_MODEL;
  if (!model) {
    throw new Error('GEMINI_TTS_MODEL is not set. Create a .env or set the variable before generating.');
  }
  const outputDir = runAudioDir(runId);
  await mkdir(outputDir, { recursive: true });

  const response = await ai.models.generateContent({
    model,
    config: {
      temperature: 1,
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            {
              speaker: 'Speaker 1',
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: process.env.GEMINI_TTS_SPEAKER_1 || 'Zephyr'
                }
              }
            },
            {
              speaker: 'Speaker 2',
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: process.env.GEMINI_TTS_SPEAKER_2 || 'Puck'
                }
              }
            }
          ]
        }
      }
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildTtsPrompt(conversation) }]
      }
    ]
  } as never);

  const inlineData = extractInlineAudio(response);
  if (inlineData?.data) {
    const audio = audioBufferForInlineData(inlineData);
    const fileName = `${conversation.id}.${audio.extension}`;
    const filePath = path.join(outputDir, fileName);
    const temporaryPath = path.join(outputDir, `.${conversation.id}.${jobToken}.${audio.extension}.tmp`);
    await writeFile(temporaryPath, audio.buffer);
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return { fileName, filePath };
  }

  throw new Error('Gemini TTS returned no audio data.');
}

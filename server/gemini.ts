import { GoogleGenAI } from '@google/genai';
import mime from 'mime';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationLine, PracticeConversation } from '../shared/types.ts';
import { runAudioDir } from './storage.ts';

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
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

export async function generateConversationJson(prompt: string): Promise<unknown> {
  const ai = getAi();
  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.75,
      responseMimeType: 'application/json'
    }
  } as never);

  const text = await responseText(response);
  if (!text.trim()) {
    throw new Error('Gemini returned an empty generation response.');
  }

  return JSON.parse(stripJsonFences(text));
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

export async function generateConversationAudio(runId: string, conversation: PracticeConversation): Promise<{ fileName: string; filePath: string }> {
  const ai = getAi();
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
  const outputDir = runAudioDir(runId);
  await mkdir(outputDir, { recursive: true });

  const response = await ai.models.generateContentStream({
    model,
    config: {
      temperature: 1,
      responseModalities: ['audio'],
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

  let index = 0;
  for await (const chunk of response as AsyncIterable<{
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  }>) {
    const inlineData = chunk.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
    if (!inlineData?.data) continue;

    const extension = mime.getExtension(inlineData.mimeType || '') || 'wav';
    const buffer = extension === 'wav' ? Buffer.from(inlineData.data, 'base64') : Buffer.from(inlineData.data, 'base64');
    const finalExtension = mime.getExtension(inlineData.mimeType || '') ? extension : 'wav';
    const finalBuffer = mime.getExtension(inlineData.mimeType || '') ? buffer : convertToWav(inlineData.data, inlineData.mimeType || '');
    const fileName = `${conversation.id}${index ? `-${index}` : ''}.${finalExtension}`;
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, finalBuffer);
    return { fileName, filePath };
  }

  throw new Error('Gemini TTS returned no audio data.');
}

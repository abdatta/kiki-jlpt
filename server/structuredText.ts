import type { TextModelInfo } from '../shared/types.ts';
import { generateCodexStructuredJson } from './codexText.ts';
import { generateGeminiStructuredJson } from './gemini.ts';

export interface StructuredJsonResult {
  parsed: unknown;
  output: string;
  stats?: unknown;
}

export type StructuredJsonInvoker = (
  prompt: string,
  textModel: TextModelInfo,
  instructions: string
) => Promise<StructuredJsonResult>;

export const invokeStructuredJson: StructuredJsonInvoker = async (prompt, textModel, instructions) => {
  return textModel.provider === 'codex'
    ? generateCodexStructuredJson(prompt, textModel.model, instructions)
    : generateGeminiStructuredJson(prompt, textModel.model, 0.2);
};

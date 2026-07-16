import type { TextModelInfo } from '../shared/types.ts';
import { generateClaudeStructuredJson } from './claudeText.ts';
import { generateCodexStructuredJson } from './codexText.ts';
import { generateGeminiStructuredJson } from './gemini.ts';

export interface StructuredJsonResult {
  parsed: unknown;
  output: string;
  stats?: unknown;
}

export interface StructuredJsonOptions {
  timeoutMs?: number;
}

export type StructuredJsonInvoker = (
  prompt: string,
  textModel: TextModelInfo,
  instructions: string,
  options?: StructuredJsonOptions
) => Promise<StructuredJsonResult>;

export const invokeStructuredJson: StructuredJsonInvoker = async (prompt, textModel, instructions, options) => {
  switch (textModel.provider) {
    case 'codex':
      return generateCodexStructuredJson(prompt, textModel.model, instructions, options?.timeoutMs);
    case 'claude':
      return generateClaudeStructuredJson(prompt, textModel.model, instructions, options?.timeoutMs);
    default:
      return generateGeminiStructuredJson(prompt, textModel.model, 0.2, options?.timeoutMs);
  }
};

import type { TextModelInfo } from '../shared/types.ts';
import { generateClaudeStructuredJson } from './claudeText.ts';
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
  switch (textModel.provider) {
    case 'codex':
      return generateCodexStructuredJson(prompt, textModel.model, instructions);
    case 'claude':
      return generateClaudeStructuredJson(prompt, textModel.model, instructions);
    default:
      return generateGeminiStructuredJson(prompt, textModel.model, 0.2);
  }
};

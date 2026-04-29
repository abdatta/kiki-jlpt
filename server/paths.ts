import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CSV_PATH = path.join(ROOT_DIR, 'jlpt_n5_master_vocab_by_set_clean.csv');
export const PROMPT_PATH = path.join(ROOT_DIR, 'convo-generator-prompt.md');
export const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs');
export const RUNS_DIR = path.join(OUTPUTS_DIR, 'runs');

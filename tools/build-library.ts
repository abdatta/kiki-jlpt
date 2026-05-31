import path from 'node:path';
import { ROOT_DIR } from '../server/paths.ts';
import { publishPracticeLibrary } from '../server/practiceLibrary.ts';

const result = await publishPracticeLibrary();
const manifestPath = path.relative(ROOT_DIR, path.join(ROOT_DIR, 'public', 'library', 'library.json'));

console.log(`Published ${result.manifest.conversations.length} conversations to ${manifestPath}.`);

import { getPracticeLibraryPublishStatus } from '../server/practiceLibrary.ts';

const status = await getPracticeLibraryPublishStatus();

if (!status.stale) {
  console.log('Practice library is up to date.');
  process.exit(0);
}

console.error(`
Practice library has unpublished updates.

Curated publishable conversations: ${status.curatedConversationCount}
Published conversations: ${status.publishedConversationCount}
Latest curated update: ${status.curatedGeneratedAt || '(none)'}
Latest published update: ${status.publishedGeneratedAt || '(none)'}

Run this before committing:
  npm run library:build

Then include the updated public/library/library.json in your commit.
`);

process.exit(1);

import type { StaticLibraryManifest } from './types.ts';

export const emptyLibrary: StaticLibraryManifest = {
  version: 2,
  generatedAt: '',
  conversations: []
};

export async function loadLibrary(): Promise<StaticLibraryManifest> {
  const base = import.meta.env.BASE_URL || './';
  const url = `${base.replace(/\/?$/, '/') }library/library.json`;
  const response = await fetch(url, { cache: 'no-cache' });

  if (!response.ok) {
    if (response.status === 404) return emptyLibrary;
    throw new Error(`Could not load practice library (${response.status}).`);
  }

  const payload = await response.json() as StaticLibraryManifest;
  return {
    ...emptyLibrary,
    ...payload,
    conversations: Array.isArray(payload.conversations)
      ? payload.conversations.map((conversation) => ({
        ...conversation,
        vocabularyUsed: Array.isArray(conversation.vocabularyUsed) ? conversation.vocabularyUsed : []
      }))
      : []
  };
}

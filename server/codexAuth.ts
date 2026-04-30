import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CODEX_API_URL, HEADERS, refreshAccessToken } from 'gpt-oauth-client';
import type { GPTOAuthSession } from 'gpt-oauth-client';
import { ROOT_DIR } from './paths.ts';

export const CODEX_MODELS_URL = `${new URL(CODEX_API_URL).origin}/backend-api/codex/models`;

export function codexSessionPath(): string {
  return path.resolve(process.env.CODEX_AUTH_SESSION_PATH || path.join(ROOT_DIR, '..', 'codex-auth', 'sessions', 'session.json'));
}

async function saveSession(sessionPath: string, session: GPTOAuthSession): Promise<void> {
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

export async function readCodexSession(): Promise<GPTOAuthSession> {
  const sessionPath = codexSessionPath();
  const session = JSON.parse(await readFile(sessionPath, 'utf8')) as Partial<GPTOAuthSession>;
  if (!session.accessToken || !session.refreshToken) {
    throw new Error(`Codex auth session is missing tokens at ${sessionPath}.`);
  }

  if (!session.accountId) {
    session.accountId = '';
  }

  if (session.expiresAt && Date.now() >= session.expiresAt) {
    const refreshed = await refreshAccessToken(session.refreshToken);
    if (refreshed.type !== 'success' || !refreshed.access || !refreshed.refresh) {
      throw new Error('Codex auth session is expired and refresh failed.');
    }
    const nextSession: GPTOAuthSession = {
      accessToken: refreshed.access,
      refreshToken: refreshed.refresh,
      expiresAt: refreshed.expires || Date.now() + 3600000,
      accountId: session.accountId
    };
    await saveSession(sessionPath, nextSession);
    return nextSession;
  }

  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt || Date.now() + 3600000,
    accountId: session.accountId
  };
}

export async function codexFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const session = await readCodexSession();
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'OpenAI-Beta': 'responses=experimental',
      'chatgpt-account-id': session.accountId,
      [HEADERS.ORIGINATOR]: 'codex_cli_rs',
      ...(init.headers ?? {})
    }
  });
}

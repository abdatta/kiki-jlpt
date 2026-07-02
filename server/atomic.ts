import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TRANSIENT_FS_CODES = new Set(['ENOENT', 'EPERM', 'EBUSY', 'EACCES']);

/**
 * Retries an fs operation that can transiently fail on Windows while another
 * process or handle briefly holds the target (including the short window in
 * atomicWriteFile's backup-swap fallback where the destination is absent).
 */
export async function retryTransientFs<T>(operation: () => Promise<T>, attempts = 4, delayMs = 12): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !TRANSIENT_FS_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  await writeFile(temporaryPath, data);
  try {
    // Windows fails a replacing rename while a reader briefly holds the target,
    // so retry the no-gap path before falling back to the backup swap (which
    // leaves the destination missing for an instant).
    await retryTransientFs(() => rename(temporaryPath, filePath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EEXIST') {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    const backupPath = `${filePath}.${process.pid}.${Date.now()}.bak`;
    let backedUp = false;
    try {
      await rename(filePath, backupPath);
      backedUp = true;
      await rename(temporaryPath, filePath);
      await rm(backupPath, { force: true });
    } catch (replacementError) {
      if (backedUp) await rename(backupPath, filePath).catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw replacementError;
    }
  }
}

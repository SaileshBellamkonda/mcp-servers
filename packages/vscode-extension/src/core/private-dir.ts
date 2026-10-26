import { chmod, mkdir } from 'node:fs/promises';

/**
 * Makes sure `directory` exists. A directory this call creates gets mode 0700 (whatever the umask is), because it
 * holds data only the user's own processes should read (the CodeRAG index, the headers helper). One that already
 * exists was not created by us and keeps its mode. On Windows POSIX modes do not exist and the profile's ACL applies.
 */
export async function ensurePrivateDirectory(directory: string): Promise<void> {
  const firstCreated = await mkdir(directory, { recursive: true, mode: 0o700 });
  if (firstCreated !== undefined) await chmod(directory, 0o700).catch(() => undefined);
}

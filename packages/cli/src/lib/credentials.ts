import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config';

/**
 * Stored credentials for the logged-in account.
 *
 * Kept in a SEPARATE file from sites.json so the API key (a long-lived secret) is
 * never co-mingled with per-site claim tokens, and so `easl logout` can wipe the
 * key without touching the site list. Written with mode 0600 (see writeCredentials).
 */
export interface Credentials {
  /** The full `easl_<…>` API key. The only secret stored here. */
  apiKey: string;
  /** The better-auth id of the key (used by `easl auth revoke`/`logout`). */
  keyId?: string;
  /** Account email, for display in `easl login`/`whoami`. Never used for auth. */
  email?: string;
  /** ISO timestamp the key was stored. */
  createdAt?: string;
}

function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json');
}

/**
 * Read the stored credentials file, or `null` if absent/unreadable.
 *
 * Tolerant by design: a missing or corrupt file means "not logged in", not a hard
 * error — the resolver simply falls through to anonymous.
 */
export function readCredentials(): Credentials | null {
  try {
    const data = JSON.parse(readFileSync(getCredentialsPath(), 'utf-8'));
    if (data && typeof data.apiKey === 'string' && data.apiKey.length > 0) {
      return data as Credentials;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist credentials to `~/.config/easl/credentials.json` with mode 0600 so the
 * API key is readable only by the owning user. We deliberately do NOT use an OS
 * keychain (keytar) — its native module would complicate the `bun build --compile`
 * single-binary build. The plain 0600 file is the v1 store (see plan open-items).
 */
export function writeCredentials(creds: Credentials): void {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(getCredentialsPath(), `${JSON.stringify(creds, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** Remove the credentials file. Returns true if a file was actually deleted. */
export function clearCredentials(): boolean {
  const path = getCredentialsPath();
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

export function credentialsExist(): boolean {
  return readCredentials() != null;
}

/**
 * Three-tier API-key resolution (highest precedence first):
 *   1. `--api-key` flag (per-invocation override)
 *   2. `EASL_API_KEY` environment variable
 *   3. `~/.config/easl/credentials.json` (written by `easl login`, mode 0600)
 *
 * Returns the resolved key, or `null` if none of the tiers provide one (anonymous).
 * Empty/whitespace-only values at a tier are ignored so they don't mask a lower
 * tier — e.g. `EASL_API_KEY=""` should not block the stored credentials file.
 */
export function resolveApiKey(flagValue?: string): string | null {
  const flag = flagValue?.trim();
  if (flag) return flag;

  const env = process.env.EASL_API_KEY?.trim();
  if (env) return env;

  const stored = readCredentials();
  if (stored?.apiKey) return stored.apiKey;

  return null;
}

/** True when any of the three tiers resolves a key. */
export function isAuthenticated(flagValue?: string): boolean {
  return resolveApiKey(flagValue) != null;
}

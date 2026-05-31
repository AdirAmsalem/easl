import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  clearCredentials,
  credentialsExist,
  isAuthenticated,
  readCredentials,
  resolveApiKey,
  writeCredentials,
} from './credentials';

describe('credentials', () => {
  let tmpDir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalKey = process.env.EASL_API_KEY;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `easl-creds-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tmpDir;
    delete process.env.EASL_API_KEY;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalXdg) process.env.XDG_CONFIG_HOME = originalXdg;
    else delete process.env.XDG_CONFIG_HOME;
    if (originalKey !== undefined) process.env.EASL_API_KEY = originalKey;
    else delete process.env.EASL_API_KEY;
  });

  test('readCredentials returns null when no file exists', () => {
    expect(readCredentials()).toBeNull();
    expect(credentialsExist()).toBe(false);
  });

  test('write then read round-trips', () => {
    writeCredentials({ apiKey: 'easl_abc', keyId: 'k1', email: 'a@b.dev' });
    const creds = readCredentials();
    expect(creds).not.toBeNull();
    expect(creds!.apiKey).toBe('easl_abc');
    expect(creds!.keyId).toBe('k1');
    expect(creds!.email).toBe('a@b.dev');
    expect(credentialsExist()).toBe(true);
  });

  test('credentials file is written with mode 0600', () => {
    writeCredentials({ apiKey: 'easl_secret' });
    const path = join(tmpDir, 'easl', 'credentials.json');
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('clearCredentials removes the file', () => {
    writeCredentials({ apiKey: 'easl_abc' });
    expect(clearCredentials()).toBe(true);
    expect(credentialsExist()).toBe(false);
    // Idempotent: no file to remove the second time.
    expect(clearCredentials()).toBe(false);
  });

  test('readCredentials ignores a file without a usable apiKey', () => {
    // Manually write a malformed credentials file (no apiKey field).
    mkdirSync(join(tmpDir, 'easl'), { recursive: true });
    rmSync(join(tmpDir, 'easl', 'credentials.json'), { force: true });
    writeCredentials({ apiKey: '' });
    expect(readCredentials()).toBeNull();
  });

  describe('resolveApiKey precedence', () => {
    test('--api-key flag wins over env and file', () => {
      process.env.EASL_API_KEY = 'easl_env';
      writeCredentials({ apiKey: 'easl_file' });
      expect(resolveApiKey('easl_flag')).toBe('easl_flag');
    });

    test('env wins over file when no flag', () => {
      process.env.EASL_API_KEY = 'easl_env';
      writeCredentials({ apiKey: 'easl_file' });
      expect(resolveApiKey()).toBe('easl_env');
    });

    test('file used when no flag and no env', () => {
      writeCredentials({ apiKey: 'easl_file' });
      expect(resolveApiKey()).toBe('easl_file');
    });

    test('returns null when nothing is set', () => {
      expect(resolveApiKey()).toBeNull();
      expect(isAuthenticated()).toBe(false);
    });

    test('blank flag falls through to env', () => {
      process.env.EASL_API_KEY = 'easl_env';
      expect(resolveApiKey('   ')).toBe('easl_env');
    });

    test('blank env does not mask the file', () => {
      process.env.EASL_API_KEY = '   ';
      writeCredentials({ apiKey: 'easl_file' });
      expect(resolveApiKey()).toBe('easl_file');
    });

    test('isAuthenticated is true when any tier resolves', () => {
      expect(isAuthenticated('easl_flag')).toBe(true);
      process.env.EASL_API_KEY = 'easl_env';
      expect(isAuthenticated()).toBe(true);
    });
  });
});

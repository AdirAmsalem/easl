import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';
import { apiRequest } from './client';
import { writeCredentials } from './credentials';

/** Capture the headers passed to fetch for a single 200 JSON response. */
function mockFetchOnce(): MockInstance {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  return spy;
}

function headersFrom(spy: MockInstance): Headers {
  const init = spy.mock.calls[0][1] as RequestInit;
  return init.headers as Headers;
}

describe('apiRequest Authorization header', () => {
  let tmpDir: string;
  let fetchSpy: MockInstance;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalKey = process.env.EASL_API_KEY;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `easl-client-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tmpDir;
    delete process.env.EASL_API_KEY;
    fetchSpy = mockFetchOnce();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalXdg) process.env.XDG_CONFIG_HOME = originalXdg;
    else delete process.env.XDG_CONFIG_HOME;
    if (originalKey !== undefined) process.env.EASL_API_KEY = originalKey;
    else delete process.env.EASL_API_KEY;
  });

  test('omits Authorization when no key is resolvable', async () => {
    await apiRequest('GET', '/sites/x', {});
    expect(headersFrom(fetchSpy).has('Authorization')).toBe(false);
  });

  test('injects Bearer from the --api-key flag', async () => {
    await apiRequest('GET', '/sites/x', { apiKey: 'easl_flag' });
    expect(headersFrom(fetchSpy).get('Authorization')).toBe('Bearer easl_flag');
  });

  test('injects Bearer from EASL_API_KEY env', async () => {
    process.env.EASL_API_KEY = 'easl_env';
    await apiRequest('GET', '/sites/x', {});
    expect(headersFrom(fetchSpy).get('Authorization')).toBe('Bearer easl_env');
  });

  test('injects Bearer from the credentials file', async () => {
    writeCredentials({ apiKey: 'easl_file' });
    await apiRequest('GET', '/sites/x', {});
    expect(headersFrom(fetchSpy).get('Authorization')).toBe('Bearer easl_file');
  });

  test('keeps the X-Claim-Token path working alongside Bearer', async () => {
    await apiRequest('DELETE', '/sites/x', { apiKey: 'easl_flag' }, undefined, {
      'X-Claim-Token': 'tok_123',
    });
    const headers = headersFrom(fetchSpy);
    expect(headers.get('Authorization')).toBe('Bearer easl_flag');
    expect(headers.get('X-Claim-Token')).toBe('tok_123');
  });
});

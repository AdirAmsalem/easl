import { describe, expect, it } from 'vitest';
import {
  CALLBACK_PATH,
  generateState,
  startCallbackServer,
} from './auth-server';

/** GET the loopback callback URL with the given query and return the HTTP status. */
async function hitCallback(
  port: number,
  query: Record<string, string>,
): Promise<number> {
  const url = new URL(`http://127.0.0.1:${port}${CALLBACK_PATH}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url);
  // Drain the body so the socket closes promptly.
  await res.text();
  return res.status;
}

describe('generateState', () => {
  it('produces a URL-safe nonce that satisfies the worker sanitizeCliState shape', () => {
    const s = generateState();
    // Worker's sanitizeCliState accepts /^[A-Za-z0-9_-]{16,128}$/.
    expect(s).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it('is random (two calls differ)', () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe('startCallbackServer state binding', () => {
  it('resolves with the key when the callback state matches', async () => {
    const state = generateState();
    const server = await startCallbackServer(2_000, state);
    try {
      const wait = server.waitForKey();
      const status = await hitCallback(server.port, {
        key: 'easl_test_key',
        id: 'key-1',
        email: 'a@example.com',
        state,
      });
      expect(status).toBe(200);
      const result = await wait;
      expect(result.apiKey).toBe('easl_test_key');
      expect(result.keyId).toBe('key-1');
      expect(result.email).toBe('a@example.com');
    } finally {
      server.close();
    }
  });

  it('rejects a callback whose state does not match (and does NOT resolve the key)', async () => {
    const state = generateState();
    const server = await startCallbackServer(800, state);
    try {
      const wait = server.waitForKey();
      // An attacker-shaped hit: a key but a wrong/absent state.
      const wrong = await hitCallback(server.port, {
        key: 'easl_attacker_key',
        state: generateState(), // different nonce
      });
      expect(wrong).toBe(403);

      const missing = await hitCallback(server.port, { key: 'easl_attacker_key' });
      expect(missing).toBe(403);

      // The pending wait must NOT have been resolved with the injected key — it
      // stays pending until the timeout fires.
      await expect(wait).rejects.toThrow(/Timed out/);
    } finally {
      server.close();
    }
  });

  it('rejects a mismatched hit but still resolves once the legitimate state arrives', async () => {
    const state = generateState();
    const server = await startCallbackServer(2_000, state);
    try {
      const wait = server.waitForKey();
      // Stray hit with the wrong state is refused...
      expect(await hitCallback(server.port, { key: 'easl_bad', state: 'nope-not-it-1234567' })).toBe(403);
      // ...then the real browser callback (correct state) resolves the wait.
      expect(
        await hitCallback(server.port, { key: 'easl_good', state }),
      ).toBe(200);
      const result = await wait;
      expect(result.apiKey).toBe('easl_good');
    } finally {
      server.close();
    }
  });

  it('without an expected state, accepts any callback (back-compat / --with-key paths)', async () => {
    const server = await startCallbackServer(2_000);
    try {
      const wait = server.waitForKey();
      expect(await hitCallback(server.port, { key: 'easl_anything' })).toBe(200);
      expect((await wait).apiKey).toBe('easl_anything');
    } finally {
      server.close();
    }
  });
});

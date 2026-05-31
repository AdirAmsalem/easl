import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';
import { publishCommand } from './publish';

/**
 * Build a fresh root program with the global options publish reads via
 * optsWithGlobals(), mirroring src/cli.ts, and mount the publish command.
 */
function rootWithPublish(): Command {
  const program = new Command()
    .name('easl')
    .option('--json')
    .option('-q, --quiet')
    .option('--api-url <url>')
    .option('--api-key <key>')
    .exitOverride(); // throw instead of process.exit on commander-level errors
  program.addCommand(publishCommand);
  return program as unknown as Command;
}

describe('publish --private auth gate', () => {
  let tmpDir: string;
  let exitSpy: MockInstance;
  let logSpy: MockInstance;
  let fetchSpy: MockInstance;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalKey = process.env.EASL_API_KEY;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `easl-publish-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tmpDir; // isolated credentials + sites store
    delete process.env.EASL_API_KEY;
    // process.exit becomes a throw so the action halts where outputError fires.
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('__exit__');
      }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    fetchSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalXdg) process.env.XDG_CONFIG_HOME = originalXdg;
    else delete process.env.XDG_CONFIG_HOME;
    if (originalKey !== undefined) process.env.EASL_API_KEY = originalKey;
    else delete process.env.EASL_API_KEY;
  });

  test('--private without authentication errors before any network call', async () => {
    const program = rootWithPublish();
    await expect(
      program.parseAsync(
        ['publish', '--content', '# hi', '--type', 'markdown', '--private', '--json'],
        { from: 'user' },
      ),
    ).rejects.toThrow('__exit__');

    // Surfaced the auth_error envelope...
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('auth_error');
    expect(printed).toMatch(/--private requires authentication/i);
    // ...and never hit the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('--private with --api-key passes the auth gate (reaches the network)', async () => {
    // Stub the publish response so the action completes past the auth gate.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          url: 'https://x.easl.dev',
          slug: 'x',
          claimToken: 't',
          embed: '',
          shareText: '',
          expiresAt: new Date().toISOString(),
          anonymous: false,
          visibility: 'private',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const program = rootWithPublish();
    await program.parseAsync(
      [
        'publish',
        '--content',
        '# hi',
        '--type',
        'markdown',
        '--private',
        '--api-key',
        'easl_test',
        '--json',
      ],
      { from: 'user' },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer easl_test');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.private).toBe(true);
  });
});

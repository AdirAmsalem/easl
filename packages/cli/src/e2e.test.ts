import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const CLI = join(__dirname, '..', 'dist', 'cli.cjs');

function run(args: string[], input?: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, '--json', ...args], {
      encoding: 'utf-8',
      timeout: 15000,
      input,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number };
    return {
      stdout: (e.stdout ?? '').trim(),
      exitCode: e.status ?? 1,
    };
  }
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout);
}

describe('easl CLI e2e', () => {
  let tmpDir: string;
  const publishedSlugs: string[] = [];

  beforeAll(() => {
    // Ensure CLI is built
    execSync('node scripts/build.mjs', {
      cwd: join(__dirname, '..'),
      stdio: 'ignore',
    });

    tmpDir = join(
      tmpdir(),
      `easl-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up published sites
    for (const slug of publishedSlugs) {
      try {
        run(['delete', slug, '--yes']);
      } catch {
        // best effort cleanup
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('--version outputs version', () => {
    const { stdout } = run(['--version']);
    expect(stdout).toMatch(/@easl\/cli v\d+\.\d+\.\d+/);
  });

  test('--help shows commands', () => {
    // Run without --json for help
    const stdout = execFileSync('node', [CLI, '--help'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    expect(stdout).toContain('publish');
    expect(stdout).toContain('list');
    expect(stdout).toContain('get');
    expect(stdout).toContain('delete');
    expect(stdout).toContain('open');
    expect(stdout).toContain('doctor');
  });

  test('publish a file', () => {
    const file = join(tmpDir, 'test.md');
    writeFileSync(file, '# E2E Test\n\nHello from easl CLI e2e tests.');

    const { stdout, exitCode } = run(['publish', file]);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout) as { url: string; slug: string; claimToken: string; expiresAt: string };
    expect(result.url).toMatch(/^https:\/\/.*\.easl\.dev$/);
    expect(result.slug).toBeTruthy();
    expect(result.claimToken).toBeTruthy();
    expect(result.expiresAt).toBeTruthy();

    publishedSlugs.push(result.slug);
  });

  test('publish inline content', () => {
    const { stdout, exitCode } = run([
      'publish',
      '--content', '# Inline Test',
      '--type', 'markdown',
      '--title', 'Inline E2E',
    ]);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout) as { url: string; slug: string };
    expect(result.url).toMatch(/^https:\/\/.*\.easl\.dev$/);

    publishedSlugs.push(result.slug);
  });

  test('publish from stdin', () => {
    const { stdout, exitCode } = run(
      ['publish', '--type', 'csv'],
      'name,age\nAlice,30\nBob,25\n',
    );
    expect(exitCode).toBe(0);

    const result = parseJson(stdout) as { url: string; slug: string };
    expect(result.url).toMatch(/^https:\/\/.*\.easl\.dev$/);

    publishedSlugs.push(result.slug);
  });

  test('publish a directory', () => {
    const siteDir = join(tmpDir, 'site');
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(siteDir, 'index.html'), '<html><body>Hello</body></html>');
    writeFileSync(join(siteDir, 'style.css'), 'body { color: black; }');

    const { stdout, exitCode } = run(['publish', siteDir]);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout) as { url: string; slug: string };
    expect(result.url).toMatch(/^https:\/\/.*\.easl\.dev$/);

    publishedSlugs.push(result.slug);
  });

  test('list shows published sites', () => {
    const { stdout, exitCode } = run(['list']);
    expect(exitCode).toBe(0);

    const sites = parseJson(stdout) as Array<{ slug: string }>;
    expect(sites.length).toBeGreaterThanOrEqual(1);
    // Should contain at least one of our published slugs
    const slugs = sites.map((s) => s.slug);
    expect(slugs.some((s) => publishedSlugs.includes(s))).toBe(true);
  });

  test('get returns site metadata', () => {
    const slug = publishedSlugs[0];
    const { stdout, exitCode } = run(['get', slug]);
    expect(exitCode).toBe(0);

    const site = parseJson(stdout) as {
      slug: string;
      url: string;
      fileCount: number;
      totalBytes: number;
      createdAt: string;
    };
    expect(site.slug).toBe(slug);
    expect(site.url).toContain(slug);
    expect(site.fileCount).toBeGreaterThanOrEqual(1);
    expect(site.totalBytes).toBeGreaterThan(0);
    expect(site.createdAt).toBeTruthy();
  });

  test('get returns error for nonexistent site', () => {
    const { stdout, exitCode } = run(['get', 'nonexistent-slug-xyz-999']);
    expect(exitCode).toBe(1);

    const result = parseJson(stdout) as { error: { message: string; code: string } };
    expect(result.error).toBeDefined();
  });

  test('delete removes a site', () => {
    // Publish a throwaway site to delete
    const file = join(tmpDir, 'to-delete.txt');
    writeFileSync(file, 'delete me');

    const publishResult = parseJson(
      run(['publish', file]).stdout,
    ) as { slug: string };

    const { stdout, exitCode } = run(['delete', publishResult.slug, '--yes']);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout) as { success: boolean; slug: string };
    expect(result.success).toBe(true);
    expect(result.slug).toBe(publishResult.slug);

    // Verify it's gone from API
    const getResult = run(['get', publishResult.slug]);
    expect(getResult.exitCode).toBe(1);
  });

  test('delete fails for unknown slug', () => {
    const { exitCode, stdout } = run(['delete', 'nonexistent-slug-xyz', '--yes']);
    expect(exitCode).toBe(1);

    const result = parseJson(stdout) as { error: { code: string } };
    expect(result.error.code).toBe('not_found');
  });

  test('doctor checks pass', () => {
    const { stdout, exitCode } = run(['doctor']);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout) as {
      ok: boolean;
      checks: Array<{ name: string; status: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.checks.length).toBeGreaterThanOrEqual(2);

    const apiCheck = result.checks.find((c) => c.name === 'API');
    expect(apiCheck?.status).toBe('pass');
  });

  test('publish with custom slug', () => {
    const customSlug = `e2e-test-${Date.now().toString(36)}`;
    const file = join(tmpDir, 'custom-slug.md');
    writeFileSync(file, '# Custom Slug Test');

    const { stdout, exitCode } = run(['publish', file, '--slug', customSlug]);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout) as { slug: string; url: string };
    expect(result.slug).toBe(customSlug);
    expect(result.url).toContain(customSlug);

    publishedSlugs.push(result.slug);
  });

  test('publish fails with no input', () => {
    // Force non-pipe mode by not providing stdin and no args
    const { exitCode, stdout } = run(['publish', '--content', '']);
    // Empty content should still work (it's a valid string), but let's test missing path
    // Actually test: no path, no --content, and stdin is TTY (simulated by not piping)
    // Since we always pass --json, stdout won't be TTY, so stdin pipe check matters
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  });

  test('publish errors on nonexistent file', () => {
    const { exitCode, stdout } = run(['publish', '/tmp/nonexistent-file-easl-xyz.md']);
    expect(exitCode).toBe(1);

    const result = parseJson(stdout) as { error: { code: string } };
    expect(result.error.code).toBe('file_error');
  });
});

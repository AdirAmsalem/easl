import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  formatBytes,
  inferContentType,
  isBinaryContentType,
  resolveContentType,
  walkDir,
} from './files';

describe('inferContentType', () => {
  test('returns correct type for markdown', () => {
    expect(inferContentType('report.md')).toBe('text/markdown; charset=utf-8');
  });

  test('returns correct type for CSV', () => {
    expect(inferContentType('data.csv')).toBe('text/csv; charset=utf-8');
  });

  test('returns correct type for HTML', () => {
    expect(inferContentType('index.html')).toBe('text/html; charset=utf-8');
  });

  test('returns correct type for JSON', () => {
    expect(inferContentType('data.json')).toBe('application/json; charset=utf-8');
  });

  test('returns correct type for SVG', () => {
    expect(inferContentType('image.svg')).toBe('image/svg+xml');
  });

  test('returns correct type for PNG', () => {
    expect(inferContentType('photo.png')).toBe('image/png');
  });

  test('returns correct type for PDF', () => {
    expect(inferContentType('doc.pdf')).toBe('application/pdf');
  });

  test('returns correct type for Mermaid', () => {
    expect(inferContentType('diagram.mmd')).toBe('text/x-mermaid; charset=utf-8');
  });

  test('returns octet-stream for unknown extensions', () => {
    expect(inferContentType('data.xyz')).toBe('application/octet-stream');
  });

  test('handles uppercase extensions', () => {
    expect(inferContentType('image.PNG')).toBe('image/png');
  });

  test('handles paths with directories', () => {
    expect(inferContentType('src/pages/index.html')).toBe('text/html; charset=utf-8');
  });
});

describe('resolveContentType', () => {
  test('resolves alias "markdown"', () => {
    expect(resolveContentType('markdown')).toBe('text/markdown; charset=utf-8');
  });

  test('resolves alias "csv"', () => {
    expect(resolveContentType('csv')).toBe('text/csv; charset=utf-8');
  });

  test('resolves alias "json"', () => {
    expect(resolveContentType('json')).toBe('application/json; charset=utf-8');
  });

  test('resolves alias "mermaid"', () => {
    expect(resolveContentType('mermaid')).toBe('text/x-mermaid; charset=utf-8');
  });

  test('passes through raw MIME types', () => {
    expect(resolveContentType('text/csv')).toBe('text/csv');
  });

  test('falls back to filename inference', () => {
    expect(resolveContentType(undefined, 'report.md')).toBe('text/markdown; charset=utf-8');
  });

  test('defaults to text/plain', () => {
    expect(resolveContentType()).toBe('text/plain; charset=utf-8');
  });

  test('type flag takes priority over filename', () => {
    expect(resolveContentType('json', 'report.md')).toBe('application/json; charset=utf-8');
  });
});

describe('isBinaryContentType', () => {
  test('images are binary', () => {
    expect(isBinaryContentType('image/png')).toBe(true);
    expect(isBinaryContentType('image/jpeg')).toBe(true);
    expect(isBinaryContentType('image/svg+xml')).toBe(true);
  });

  test('PDF is binary', () => {
    expect(isBinaryContentType('application/pdf')).toBe(true);
  });

  test('text types are not binary', () => {
    expect(isBinaryContentType('text/html; charset=utf-8')).toBe(false);
    expect(isBinaryContentType('text/markdown; charset=utf-8')).toBe(false);
  });

  test('JSON is not binary', () => {
    expect(isBinaryContentType('application/json; charset=utf-8')).toBe(false);
  });
});

describe('walkDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `easl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('lists files in a flat directory', () => {
    writeFileSync(join(tmpDir, 'index.html'), '<html></html>');
    writeFileSync(join(tmpDir, 'style.css'), 'body {}');

    const files = walkDir(tmpDir);
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['index.html', 'style.css']);
  });

  test('recursively walks subdirectories', () => {
    mkdirSync(join(tmpDir, 'sub'), { recursive: true });
    writeFileSync(join(tmpDir, 'index.html'), '<html></html>');
    writeFileSync(join(tmpDir, 'sub', 'page.html'), '<html></html>');

    const files = walkDir(tmpDir);
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['index.html', 'sub/page.html']);
  });

  test('skips dotfiles', () => {
    writeFileSync(join(tmpDir, 'index.html'), '<html></html>');
    writeFileSync(join(tmpDir, '.hidden'), 'secret');

    const files = walkDir(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('index.html');
  });

  test('skips dot directories', () => {
    mkdirSync(join(tmpDir, '.git'), { recursive: true });
    writeFileSync(join(tmpDir, '.git', 'config'), 'gitconfig');
    writeFileSync(join(tmpDir, 'index.html'), '<html></html>');

    const files = walkDir(tmpDir);
    expect(files).toHaveLength(1);
  });

  test('returns empty array for empty directory', () => {
    expect(walkDir(tmpDir)).toEqual([]);
  });

  test('includes file size', () => {
    const content = 'hello world';
    writeFileSync(join(tmpDir, 'test.txt'), content);

    const files = walkDir(tmpDir);
    expect(files[0].size).toBe(Buffer.byteLength(content));
  });
});

describe('formatBytes', () => {
  test('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  test('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  test('formats megabytes', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  test('boundary at 1024', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });
});

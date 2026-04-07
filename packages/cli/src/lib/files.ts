import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  mmd: 'text/x-mermaid; charset=utf-8',
};

// Short names used with --type flag
const TYPE_ALIASES: Record<string, string> = {
  markdown: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  text: 'text/plain; charset=utf-8',
  mermaid: 'text/x-mermaid; charset=utf-8',
  pdf: 'application/pdf',
};

export function inferContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase().replace(/^\./, '');
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export function resolveContentType(typeFlag?: string, fileName?: string): string {
  if (typeFlag) {
    // Check aliases first
    const alias = TYPE_ALIASES[typeFlag.toLowerCase()];
    if (alias) return alias;
    // Treat as raw MIME type
    if (typeFlag.includes('/')) return typeFlag;
    // Treat as extension
    return MIME_TYPES[typeFlag.toLowerCase()] ?? 'text/plain; charset=utf-8';
  }
  if (fileName) {
    return inferContentType(fileName);
  }
  return 'text/plain; charset=utf-8';
}

export function isBinaryContentType(contentType: string): boolean {
  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/') ||
    contentType.includes('application/pdf') ||
    contentType.includes('application/wasm') ||
    contentType.includes('application/octet-stream')
  );
}

export interface WalkedFile {
  relativePath: string;
  absolutePath: string;
  size: number;
}

export function walkDir(dirPath: string): WalkedFile[] {
  const results: WalkedFile[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        results.push({
          relativePath: relative(dirPath, full).split(sep).join('/'),
          absolutePath: full,
          size: stat.size,
        });
      }
    }
  }

  walk(dirPath);
  return results;
}

export function readStdin(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

export function readFileAsBase64(filePath: string): string {
  return readFileSync(filePath).toString('base64');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { addSite } from '../lib/config';
import {
  formatBytes,
  inferContentType,
  isBinaryContentType,
  readFileAsBase64,
  readStdin,
  resolveContentType,
  walkDir,
} from '../lib/files';
import { buildHelpText } from '../lib/help-text';
import { outputError, outputResult } from '../lib/output';
import { withSpinner } from '../lib/spinner';
import { isInteractive } from '../lib/tty';
import { openInBrowser } from '../lib/browser';

interface PublishFileEntry {
  path: string;
  content: string;
  contentType: string;
  encoding?: 'base64';
}

interface PublishResponse {
  url: string;
  slug: string;
  claimToken: string;
  ogImage: string;
  qrCode: string;
  embed: string;
  shareText: string;
  expiresAt: string;
  anonymous: boolean;
}

export const publishCommand = new Command('publish')
  .description('Publish a file, directory, or content as a shareable page')
  .argument('[path]', 'File or directory to publish')
  .option('--content <text>', 'Inline content to publish')
  .option(
    '--type <type>',
    'Content type (markdown, csv, html, json, svg, mermaid, or MIME type)',
  )
  .option('--title <title>', 'Page title')
  .option(
    '--template <template>',
    'Template: minimal, report, dashboard',
  )
  .option('--slug <slug>', 'Custom slug (lowercase alphanumeric + hyphens, 3-48 chars)')
  .option('--ttl <seconds>', 'Time to live in seconds')
  .option('--open', 'Open in browser after publishing')
  .option('--copy', 'Copy URL to clipboard after publishing')
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Publishes content and returns a shareable URL.\nSupports file path, directory, --content flag, or piped stdin.',
      output:
        '  {"url":"...","slug":"...","claimToken":"...","expiresAt":"..."}',
      errorCodes: ['publish_error', 'file_error', 'stdin_error'],
      examples: [
        'easl publish report.md',
        'easl publish ./my-site/',
        'easl publish --content "# Hello World" --type markdown',
        'cat data.csv | easl publish --type csv',
        'easl publish report.md --title "Q4 Report" --open',
        'easl publish chart.svg --slug my-chart --copy',
      ],
    }),
  )
  .action(async (pathArg, opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;

    let files: PublishFileEntry[];

    if (pathArg) {
      // File or directory argument
      const fullPath = resolve(pathArg);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        outputError(
          { message: `Path not found: ${pathArg}`, code: 'file_error' },
          globalOpts,
        );
      }

      if (stat.isDirectory()) {
        const walked = walkDir(fullPath);
        if (walked.length === 0) {
          outputError(
            { message: 'Directory is empty', code: 'file_error' },
            globalOpts,
          );
        }
        files = walked.map((f) => ({
          path: f.relativePath,
          content: readFileAsBase64(f.absolutePath),
          contentType: inferContentType(f.relativePath),
          encoding: 'base64' as const,
        }));
      } else {
        const contentType = resolveContentType(opts.type, fullPath);
        files = [
          {
            path: basename(fullPath),
            content: readFileAsBase64(fullPath),
            contentType,
            encoding: 'base64',
          },
        ];
      }
    } else if (opts.content != null) {
      // Inline content
      const contentType = resolveContentType(opts.type);
      files = [
        {
          path: 'content' + extForType(contentType),
          content: opts.content,
          contentType,
        },
      ];
    } else if (!process.stdin.isTTY) {
      // Stdin pipe
      const stdinBuf = await readStdin();
      if (stdinBuf.length === 0) {
        outputError(
          { message: 'No input received from stdin', code: 'stdin_error' },
          globalOpts,
        );
      }
      const contentType = resolveContentType(opts.type);
      const isBinary = isBinaryContentType(contentType);
      files = [
        {
          path: 'content' + extForType(contentType),
          content: isBinary
            ? stdinBuf.toString('base64')
            : stdinBuf.toString('utf-8'),
          contentType,
          ...(isBinary ? { encoding: 'base64' as const } : {}),
        },
      ];
    } else {
      outputError(
        {
          message:
            'No input provided. Pass a file path, use --content, or pipe via stdin.',
          code: 'publish_error',
        },
        globalOpts,
      );
    }

    const body: Record<string, unknown> = { files };
    if (opts.title) body.title = opts.title;
    if (opts.template) body.template = opts.template;
    if (opts.slug) body.slug = opts.slug;
    if (opts.ttl) body.ttl = Number(opts.ttl);

    const result = await withSpinner(
      'Publishing...',
      () =>
        apiRequest<PublishResponse>('POST', '/publish', globalOpts, body),
      'publish_error',
      globalOpts,
    );

    // Save to local config for later list/delete
    addSite({
      slug: result.slug,
      claimToken: result.claimToken,
      url: result.url,
      createdAt: new Date().toISOString(),
      title: opts.title,
      expiresAt: result.expiresAt,
    });

    if (globalOpts.json || !isInteractive()) {
      outputResult(result, globalOpts);
    } else {
      const totalSize = files.reduce(
        (sum, f) => sum + (f.encoding === 'base64'
          ? Math.ceil(f.content.length * 3 / 4)
          : f.content.length),
        0,
      );
      console.log('');
      console.log(`  ${pc.green(pc.bold(result.url))}`);
      console.log('');
      console.log(
        `  ${pc.gray('Slug:')}     ${result.slug}`,
      );
      console.log(
        `  ${pc.gray('Files:')}    ${files.length} (${formatBytes(totalSize)})`,
      );
      console.log(
        `  ${pc.gray('Expires:')}  ${result.expiresAt ? new Date(result.expiresAt).toLocaleDateString() : 'never'}`,
      );
      console.log('');
    }

    // Post-publish actions
    if (opts.open) {
      await openInBrowser(result.url);
    }
    if (opts.copy) {
      await copyToClipboard(result.url);
    }
  });

function extForType(contentType: string): string {
  const map: Record<string, string> = {
    'text/markdown': '.md',
    'text/csv': '.csv',
    'text/html': '.html',
    'application/json': '.json',
    'image/svg+xml': '.svg',
    'text/plain': '.txt',
    'text/x-mermaid': '.mmd',
    'application/pdf': '.pdf',
  };
  const base = contentType.split(';')[0].trim();
  return map[base] ?? '.txt';
}

async function copyToClipboard(text: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const cmd =
    process.platform === 'darwin'
      ? 'pbcopy'
      : process.platform === 'win32'
        ? 'clip'
        : 'xclip -selection clipboard';

  return new Promise((resolve) => {
    const proc = exec(cmd, (err) => {
      if (!err && isInteractive()) {
        console.log(`  ${pc.gray('Copied URL to clipboard')}`);
      }
      resolve();
    });
    proc.stdin?.write(text);
    proc.stdin?.end();
  });
}

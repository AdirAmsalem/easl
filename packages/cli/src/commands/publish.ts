import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { addSite } from '../lib/config';
import { isAuthenticated } from '../lib/credentials';
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
  ogImage?: string;
  qrCode?: string;
  embed: string;
  shareText: string;
  expiresAt: string;
  anonymous: boolean;
  visibility?: 'public' | 'private';
  password?: string;
  passwordNotice?: string;
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
  .option('--private', 'Account-private: only you (signed in) can view. Requires login.')
  .option(
    '--password <password>',
    'Password-protect the URL with a value you choose. Works with or without --private. Mutually exclusive with --generate-password.',
  )
  .option(
    '--generate-password',
    'Password-protect the URL with a strong password easl generates and shows once. Works with or without --private. Mutually exclusive with --password.',
  )
  .option('--open', 'Open in browser after publishing')
  .option('--copy', 'Copy URL to clipboard after publishing')
  .addHelpText(
    'after',
    buildHelpText({
      context:
        `Publishes content and returns a shareable URL.\nSupports file path, directory, --content flag, or piped stdin.\n\n${pc.gray('Privacy modes (composable):')}\n  ${pc.bold('public')}              default — anyone with the link can view\n  ${pc.bold('password-protected')}  --password X — gated by a password page\n  ${pc.bold('                  ')}  --generate-password — easl generates one, shown once\n  ${pc.bold('account-private')}     --private — only you (signed in); share via ${pc.blue('easl share')}\n  ${pc.bold('both')}                --private --password X — sign-in AND password required\n\n--password and --generate-password are mutually exclusive.\n--private requires authentication (run ${pc.blue('easl login')} or set EASL_API_KEY).`,
      output:
        '  {"url":"...","slug":"...","claimToken":"...","expiresAt":"...","visibility":"...","password":"..."}',
      errorCodes: ['publish_error', 'file_error', 'stdin_error', 'auth_error'],
      examples: [
        'easl publish report.md',
        'easl publish ./my-site/',
        'cat data.csv | easl publish --type csv',
        'easl publish report.md --password hunter2',
        'easl publish report.md --generate-password   # auto-generate a password',
        'easl login && easl publish secret.md --private',
        'easl publish secret.md --private --password hunter2',
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

    // Account gate (`--private`) and password gate (`--password`) are INDEPENDENT
    // and composable (private easls v2): public / password-protected /
    // account-private / both. `--private` binds the site to your account and
    // therefore requires authentication; `--password` is anonymous-publishable and
    // does NOT imply `--private` (unlike v1, where --password meant a gated URL).
    if (opts.private && !isAuthenticated(globalOpts.apiKey)) {
      outputError(
        {
          message:
            '--private requires authentication. Run `easl login` or set EASL_API_KEY (or pass --api-key).',
          code: 'auth_error',
        },
        globalOpts,
      );
    }

    // Two ways to request the password gate, mutually exclusive:
    //   - `--password X`        → opts.password === "X"   (explicit password, sent verbatim)
    //   - `--generate-password` → opts.generatePassword   (server mints one, returns it once)
    // `--password` takes a REQUIRED value so a value-less invocation can't swallow
    // the positional path token (e.g. `easl publish --password report.md` would
    // otherwise parse report.md as the password). `--generate-password` is a boolean
    // flag that consumes no token, so `easl publish --generate-password report.md`
    // keeps report.md as the path. Both compose with `--private`.
    if (opts.password != null && opts.generatePassword) {
      outputError(
        {
          message:
            '--password and --generate-password are mutually exclusive. Pass a value with --password, or use --generate-password to have easl mint one.',
          code: 'publish_error',
        },
        globalOpts,
      );
    }
    const explicitPassword =
      typeof opts.password === 'string' ? opts.password : undefined;
    const generatePassword = opts.generatePassword === true;

    const body: Record<string, unknown> = { files };
    if (opts.title) body.title = opts.title;
    if (opts.template) body.template = opts.template;
    if (opts.slug) body.slug = opts.slug;
    if (opts.ttl) body.ttl = Number(opts.ttl);
    if (opts.private) body.private = true;
    if (explicitPassword != null) body.password = explicitPassword;
    else if (generatePassword) body.generatePassword = true;

    const result = await withSpinner(
      'Publishing...',
      () =>
        apiRequest<PublishResponse>('POST', '/publish', globalOpts, body),
      'publish_error',
      globalOpts,
    );

    // Save to local config for later list/delete. `owner: 'me'` when the server
    // bound the site to our account (authenticated publish → anonymous === false),
    // so `open`/`get` can label it account-private and `delete` knows to use the
    // API key rather than the claim token.
    addSite({
      slug: result.slug,
      claimToken: result.claimToken,
      url: result.url,
      createdAt: new Date().toISOString(),
      title: opts.title,
      expiresAt: result.expiresAt,
      visibility: result.visibility,
      // The plaintext password to persist locally: the explicit value if the
      // caller supplied one, otherwise the server-generated one returned once.
      password: explicitPassword ?? result.password,
      owner: result.anonymous === false ? 'me' : undefined,
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
      // Privacy summary across the two composable gates. The plaintext password to
      // surface is the explicit value, else whatever the server generated and
      // returned once (when `--password` was used value-less).
      const password = explicitPassword ?? result.password;
      const accountPrivate = result.visibility === 'private';
      const passwordProtected = Boolean(password);
      if (accountPrivate || passwordProtected) {
        const modes: string[] = [];
        if (accountPrivate) modes.push('account-private (sign-in required)');
        if (passwordProtected) modes.push('password-protected');
        console.log(`  ${pc.gray('Privacy:')}  ${modes.join(' + ')}`);
        if (accountPrivate) {
          console.log(
            `  ${pc.gray('        ')}  ${pc.dim(`Share with non-account viewers via: easl share ${result.slug}`)}`,
          );
        }
        if (password) {
          console.log(
            `  ${pc.gray('Password:')} ${pc.yellow(pc.bold(password))}`,
          );
          console.log(
            `  ${pc.gray('         ')} ${pc.dim('Saved to ~/.config/easl/sites.json. Stored only here — no server recovery.')}`,
          );
        }
      }
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

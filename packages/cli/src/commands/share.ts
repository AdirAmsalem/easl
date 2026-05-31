import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { isAuthenticated } from '../lib/credentials';
import { parseDurationToSeconds } from '../lib/duration';
import { buildHelpText } from '../lib/help-text';
import { outputError, outputResult } from '../lib/output';
import { withSpinner } from '../lib/spinner';
import { isInteractive } from '../lib/tty';

interface ShareLinkResponse {
  url: string;
  expiresAt: string;
  token: string;
}

export const shareCommand = new Command('share')
  .description('Mint a signed, expiring share link for a private easl (owner-only)')
  .argument('<slug>', 'Site slug to share')
  .option(
    '--expires-in <duration>',
    'Link lifetime: e.g. 30m, 12h, 7d, 2w (default 7d, max 30d)',
  )
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Creates an unguessable, time-limited URL that lets someone without an\naccount view your account-private easl. Requires being logged in and owning\nthe site. If the site is ALSO password-protected, the recipient still needs\nthe password. Sign in with `easl login`.',
      output: '  {"url":"https://...?share=...","expiresAt":"...","token":"..."}',
      errorCodes: ['share_error', 'auth_error'],
      examples: [
        'easl share my-report',
        'easl share my-report --expires-in 24h',
        'easl share my-report --expires-in 7d --json',
      ],
    }),
  )
  .action(async (slug, opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;

    if (!isAuthenticated(globalOpts.apiKey)) {
      outputError(
        {
          message:
            'Sharing requires authentication. Run `easl login` or set EASL_API_KEY.',
          code: 'auth_error',
        },
        globalOpts,
      );
    }

    let expiresIn: number | undefined;
    if (opts.expiresIn != null) {
      try {
        expiresIn = parseDurationToSeconds(opts.expiresIn);
      } catch (err) {
        outputError(
          {
            message: err instanceof Error ? err.message : 'Invalid --expires-in',
            code: 'share_error',
          },
          globalOpts,
        );
      }
    }

    const body: Record<string, unknown> = {};
    if (expiresIn != null) body.expiresIn = expiresIn;

    const result = await withSpinner(
      'Creating share link...',
      () =>
        apiRequest<ShareLinkResponse>(
          'POST',
          `/sites/${slug}/share-links`,
          globalOpts,
          body,
        ),
      'share_error',
      globalOpts,
    );

    if (globalOpts.json || !isInteractive()) {
      outputResult(result, globalOpts);
      return;
    }

    console.log('');
    console.log(`  ${pc.green(pc.bold(result.url))}`);
    console.log('');
    console.log(
      `  ${pc.gray('Expires:')}  ${new Date(result.expiresAt).toLocaleString()}`,
    );
    console.log(
      `  ${pc.dim('Anyone with this link can view the easl until it expires.')}`,
    );
    console.log('');
  });

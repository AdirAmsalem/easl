import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { addSite, getSite } from '../lib/config';
import { isAuthenticated } from '../lib/credentials';
import { buildHelpText } from '../lib/help-text';
import { outputError, outputResult } from '../lib/output';
import { withSpinner } from '../lib/spinner';
import { isInteractive } from '../lib/tty';

interface ClaimResponse {
  success: boolean;
  slug: string;
  owned: boolean;
}

export const claimCommand = new Command('claim')
  .description('Adopt an anonymously-published site into your account')
  .argument('<slug>', 'Site slug to claim')
  .option(
    '--claim-token <token>',
    'Claim token (defaults to the one saved in local config)',
  )
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Binds an anonymous easl to your account using its claim token. After\nclaiming, the site is owned by you (manage it with your API key) and the\nold claim token is rotated server-side. Requires being logged in.\nThe claim token is read from ~/.config/easl/sites.json when not passed.',
      output: '  {"success":true,"slug":"...","owned":true}',
      errorCodes: ['claim_error', 'auth_error', 'not_found'],
      examples: [
        'easl claim my-site',
        'easl claim my-site --claim-token tok_xxx',
      ],
    }),
  )
  .action(async (slug, opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;

    if (!isAuthenticated(globalOpts.apiKey)) {
      outputError(
        {
          message:
            'Claiming requires authentication. Run `easl login` or set EASL_API_KEY.',
          code: 'auth_error',
        },
        globalOpts,
      );
    }

    const tracked = getSite(slug);
    const claimToken = opts.claimToken ?? tracked?.claimToken;
    if (!claimToken) {
      outputError(
        {
          message: `No claim token for "${slug}". Pass --claim-token, or claim from the machine that published it.`,
          code: 'not_found',
        },
        globalOpts,
      );
    }

    const result = await withSpinner(
      'Claiming site...',
      () =>
        apiRequest<ClaimResponse>(
          'POST',
          `/sites/${slug}/claim`,
          globalOpts,
          { claimToken },
        ),
      'claim_error',
      globalOpts,
    );

    // The server rotates the claim token on a successful claim, so the locally
    // stored one is now stale. Update local config to reflect ownership and drop
    // the dead token (the site is managed via the account/API key from now on).
    if (tracked) {
      addSite({ ...tracked, claimToken: '', owner: 'me' });
    }

    if (globalOpts.json || !isInteractive()) {
      outputResult(result, globalOpts);
    } else {
      console.log('');
      console.log(`  ${pc.green('Claimed')} ${pc.bold(slug)} into your account.`);
      console.log(`  ${pc.gray('Manage it with your API key; the old claim token is now revoked.')}`);
      console.log('');
    }
  });

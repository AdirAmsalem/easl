import * as p from '@clack/prompts';
import { Command } from '@commander-js/extra-typings';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { getSite, removeSite } from '../lib/config';
import { isAuthenticated } from '../lib/credentials';
import { buildHelpText } from '../lib/help-text';
import { outputError, outputResult } from '../lib/output';
import { withSpinner } from '../lib/spinner';
import { isInteractive } from '../lib/tty';

export const deleteCommand = new Command('delete')
  .alias('rm')
  .description('Delete a published site')
  .argument('<slug>', 'Site slug to delete')
  .option('-y, --yes', 'Skip confirmation prompt')
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Requires the claim token from local config.\nOnly sites published from this machine can be deleted.',
      output: '  {"success":true,"slug":"..."}',
      errorCodes: ['delete_error', 'not_found'],
      examples: [
        'easl delete my-site',
        'easl delete abc-123 --yes',
        'easl rm old-page --json',
      ],
    }),
  )
  .action(async (slug, opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;

    const site = getSite(slug);
    // The worker accepts EITHER a claim token (anonymous sites) OR the owner's
    // API key (account-owned sites). So we can delete when the site is tracked
    // locally (claim token) OR when we're authenticated (Bearer is auto-attached
    // by apiRequest). Only block when we have neither.
    const authed = isAuthenticated(globalOpts.apiKey);
    if (!site && !authed) {
      outputError(
        {
          message: `Site "${slug}" not found in local config. Publish it from this machine, or sign in with \`easl login\` to delete a site you own.`,
          code: 'not_found',
        },
        globalOpts,
      );
    }

    if (!opts.yes && isInteractive()) {
      const confirm = await p.confirm({
        message: `Delete site "${slug}"${site ? ` (${site.url})` : ''}?`,
      });
      if (p.isCancel(confirm) || !confirm) {
        console.log('Cancelled.');
        process.exit(0);
      }
    }

    // Only send the claim token when we actually have a real one. After `easl
    // claim` it's cleared (rotated server-side), and account-owned sites authorize
    // via the Bearer key instead.
    const extraHeaders =
      site?.claimToken ? { 'X-Claim-Token': site.claimToken } : undefined;

    await withSpinner(
      'Deleting...',
      () =>
        apiRequest<{ success: boolean; slug: string }>(
          'DELETE',
          `/sites/${slug}`,
          globalOpts,
          undefined,
          extraHeaders,
        ),
      'delete_error',
      globalOpts,
    );

    removeSite(slug);

    if (globalOpts.json || !isInteractive()) {
      outputResult({ success: true, slug }, globalOpts);
    } else {
      console.log(`\n  Deleted ${slug}\n`);
    }
  });

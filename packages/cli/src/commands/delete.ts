import * as p from '@clack/prompts';
import { Command } from '@commander-js/extra-typings';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { getSite, removeSite } from '../lib/config';
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
    if (!site) {
      outputError(
        {
          message: `Site "${slug}" not found in local config. Can only delete sites published from this machine.`,
          code: 'not_found',
        },
        globalOpts,
      );
    }

    if (!opts.yes && isInteractive()) {
      const confirm = await p.confirm({
        message: `Delete site "${slug}" (${site.url})?`,
      });
      if (p.isCancel(confirm) || !confirm) {
        console.log('Cancelled.');
        process.exit(0);
      }
    }

    await withSpinner(
      'Deleting...',
      () =>
        apiRequest<{ success: boolean; slug: string }>(
          'DELETE',
          `/sites/${slug}`,
          globalOpts,
          undefined,
          { 'X-Claim-Token': site.claimToken },
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

import { Command } from '@commander-js/extra-typings';
import type { GlobalOpts } from '../lib/client';
import { listSites } from '../lib/config';
import { buildHelpText } from '../lib/help-text';
import { outputResult } from '../lib/output';
import { renderTable } from '../lib/table';
import { isInteractive } from '../lib/tty';

export const listCommand = new Command('list')
  .alias('ls')
  .description('List sites published from this machine')
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Lists sites tracked in your local config (~/.config/easl/sites.json).\nOnly shows sites published from this machine.',
      output: '  [{"slug":"...","url":"...","createdAt":"..."}]',
      examples: ['easl list', 'easl list --json', 'easl ls'],
    }),
  )
  .action((_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;
    const sites = listSites();

    if (globalOpts.json || !isInteractive()) {
      outputResult(sites, globalOpts);
      return;
    }

    if (sites.length === 0) {
      console.log('\n  No sites published yet. Run: easl publish <file>\n');
      return;
    }

    const rows = sites.map((s) => [
      s.slug,
      s.url,
      s.title ?? '',
      s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '',
      s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : '',
    ]);

    console.log('');
    console.log(
      renderTable(['Slug', 'URL', 'Title', 'Created', 'Expires'], rows),
    );
    console.log('');
  });

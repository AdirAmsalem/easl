import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { formatBytes } from '../lib/files';
import { buildHelpText } from '../lib/help-text';
import { outputResult } from '../lib/output';
import { withSpinner } from '../lib/spinner';
import { isInteractive } from '../lib/tty';

interface SiteResponse {
  slug: string;
  title: string | null;
  template: string | null;
  url: string;
  fileCount: number;
  totalBytes: number;
  expiresAt: string | null;
  createdAt: string;
  versions: Array<{ id: string; status: string; created_at: string }>;
}

export const getCommand = new Command('get')
  .description('Get site metadata')
  .argument('<slug>', 'Site slug')
  .addHelpText(
    'after',
    buildHelpText({
      output:
        '  {"slug":"...","url":"...","fileCount":1,"totalBytes":1234,...}',
      errorCodes: ['fetch_error'],
      examples: ['easl get my-site', 'easl get abc-123 --json'],
    }),
  )
  .action(async (slug, _opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;

    const site = await withSpinner(
      'Fetching site...',
      () => apiRequest<SiteResponse>('GET', `/sites/${slug}`, globalOpts),
      'fetch_error',
      globalOpts,
    );

    if (globalOpts.json || !isInteractive()) {
      outputResult(site, globalOpts);
      return;
    }

    console.log('');
    console.log(`  ${pc.bold(site.url)}`);
    console.log('');
    console.log(`  ${pc.gray('Slug:')}      ${site.slug}`);
    if (site.title) {
      console.log(`  ${pc.gray('Title:')}     ${site.title}`);
    }
    if (site.template) {
      console.log(`  ${pc.gray('Template:')}  ${site.template}`);
    }
    console.log(`  ${pc.gray('Files:')}     ${site.fileCount} (${formatBytes(site.totalBytes)})`);
    console.log(`  ${pc.gray('Created:')}   ${new Date(site.createdAt).toLocaleString()}`);
    if (site.expiresAt) {
      console.log(`  ${pc.gray('Expires:')}   ${new Date(site.expiresAt).toLocaleString()}`);
    }
    if (site.versions.length > 0) {
      console.log(`  ${pc.gray('Versions:')}  ${site.versions.length}`);
    }
    console.log('');
  });

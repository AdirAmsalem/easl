import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import type { GlobalOpts } from '../lib/client';
import { openInBrowser } from '../lib/browser';
import { getSite, type TrackedSite } from '../lib/config';
import { buildHelpText } from '../lib/help-text';
import { outputError, outputResult } from '../lib/output';
import { isInteractive } from '../lib/tty';

export const openCommand = new Command('open')
  .description('Open a site or the easl dashboard in your browser')
  .argument('[slug]', 'Site slug to open (omit to open easl.dev)')
  .addHelpText(
    'after',
    buildHelpText({
      context: 'Opens a site URL or https://easl.dev in your default browser.',
      examples: ['easl open', 'easl open my-site'],
    }),
  )
  .action(async (slug, _opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;

    let url: string;
    let site: TrackedSite | undefined;
    if (slug) {
      site = getSite(slug);
      if (site) {
        url = site.url;
      } else {
        url = `https://${slug}.easl.dev`;
      }
    } else {
      url = 'https://easl.dev';
    }

    const opened = await openInBrowser(url);

    if (globalOpts.json || !isInteractive()) {
      outputResult(
        { url, opened, visibility: site?.visibility, owner: site?.owner },
        globalOpts,
      );
    } else if (opened) {
      console.log(`\n  Opened ${url}`);
      if (site?.owner === 'me') {
        console.log(`  ${pc.gray('Privacy:')}  account-private (sign-in required)`);
      } else if (site?.visibility === 'private') {
        console.log(`  ${pc.gray('Privacy:')}  private`);
      }
      if (site?.password) {
        console.log(`  ${pc.gray('Password:')} ${pc.yellow(pc.bold(site.password))}`);
      }
      console.log('');
    } else {
      outputError(
        { message: `Could not open browser. Visit ${url} manually.`, code: 'browser_error' },
        globalOpts,
      );
    }
  });

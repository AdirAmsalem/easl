import { Command } from '@commander-js/extra-typings';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { clearCredentials, readCredentials } from '../lib/credentials';
import { buildHelpText } from '../lib/help-text';
import { outputResult } from '../lib/output';
import { isInteractive } from '../lib/tty';

export const logoutCommand = new Command('logout')
  .description('Remove the saved API key from this machine')
  .option(
    '--revoke',
    'Also revoke the saved key on the server (not just locally)',
  )
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Deletes ~/.config/easl/credentials.json. With --revoke, the key is also\nrevoked server-side so it can no longer authenticate.',
      output: '  {"loggedOut":true}',
      examples: ['easl logout', 'easl logout --revoke'],
    }),
  )
  .action(async (opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;

    const creds = readCredentials();

    // Best-effort server-side revocation. We swallow errors so a network failure or
    // an already-revoked key never blocks the local logout — the credentials file
    // is removed regardless.
    let revoked = false;
    if (opts.revoke && creds?.keyId) {
      try {
        await apiRequest(
          'POST',
          '/auth/api-key/delete',
          { ...globalOpts, apiKey: creds.apiKey },
          { keyId: creds.keyId },
        );
        revoked = true;
      } catch {
        revoked = false;
      }
    }

    const had = clearCredentials();

    if (globalOpts.json || !isInteractive()) {
      outputResult({ loggedOut: true, hadCredentials: had, revoked }, globalOpts);
    } else {
      console.log('');
      if (had) {
        console.log('  Logged out. API key removed from this machine.');
        if (opts.revoke) {
          console.log(
            revoked
              ? '  Key revoked on the server.'
              : '  Could not revoke server-side (it may already be gone).',
          );
        }
      } else {
        console.log('  You were not logged in.');
      }
      console.log('');
    }
  });

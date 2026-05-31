import * as p from '@clack/prompts';
import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { type GlobalOpts, apiRequest, getWebUrl } from '../lib/client';
import { startCallbackServer } from '../lib/auth-server';
import { openInBrowser } from '../lib/browser';
import { credentialsExist, writeCredentials } from '../lib/credentials';
import { buildHelpText } from '../lib/help-text';
import { outputError, outputResult } from '../lib/output';
import { isInteractive } from '../lib/tty';

interface SessionResponse {
  user?: { id?: string; email?: string } | null;
}

/**
 * Validate an API key by resolving its session against the worker. A valid
 * `easl_<…>` key resolves to its owner (the api-key plugin runs with
 * enableSessionForAPIKeys), so this both proves the key works and yields the email
 * for display. Returns the resolved email (may be empty if the worker omits it).
 */
async function verifyKey(key: string, globalOpts: GlobalOpts): Promise<string> {
  const session = await apiRequest<SessionResponse>(
    'GET',
    '/auth/get-session',
    { ...globalOpts, apiKey: key },
  );
  if (!session || !session.user || !session.user.id) {
    throw new Error('API key is invalid or expired');
  }
  return session.user.email ?? '';
}

export const loginCommand = new Command('login')
  .description('Sign in to easl and save an API key for this machine')
  .option(
    '--with-key <key>',
    'Skip the browser flow and save an existing API key directly',
  )
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Opens your browser to sign in, then receives an API key on a local\ncallback port and saves it to ~/.config/easl/credentials.json (chmod 0600).\nThe key authenticates publishing private easls, sharing, and claiming.\nPrecedence: --api-key flag > EASL_API_KEY env > saved login.',
      output: '  {"loggedIn":true,"email":"you@example.com"}',
      errorCodes: ['login_error'],
      examples: [
        'easl login',
        'easl login --with-key easl_xxx',
        'EASL_API_KEY=easl_xxx easl publish report.md --private',
      ],
    }),
  )
  .action(async (opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;

    if (credentialsExist() && isInteractive() && !globalOpts.json && !opts.withKey) {
      const proceed = await p.confirm({
        message: 'You are already logged in. Sign in again?',
      });
      if (p.isCancel(proceed) || !proceed) {
        console.log('Cancelled.');
        process.exit(0);
      }
    }

    // Direct path: caller already has a key (CI, headless, or a key pasted from the
    // dashboard). Verify and store it without a browser round-trip.
    if (opts.withKey) {
      try {
        const email = await verifyKey(opts.withKey, globalOpts);
        writeCredentials({
          apiKey: opts.withKey,
          email: email || undefined,
          createdAt: new Date().toISOString(),
        });
        finishLogin(email, globalOpts);
      } catch (err) {
        outputError(
          {
            message: err instanceof Error ? err.message : 'Login failed',
            code: 'login_error',
          },
          globalOpts,
        );
      }
      return;
    }

    // Browser handshake: spin up a loopback callback server, open the sign-in page
    // with this server's port as `cli_port`, and wait for the minted key to arrive
    // on the callback. We pass only the port (not a loopback `next` URL): the worker
    // rebuilds the exact `http://127.0.0.1:<port>/callback` target server-side, and
    // its /auth/cli-callback route mints the API key after sign-in and redirects
    // there. (A loopback `next` would be rejected by the worker's open-redirect guard.)
    const server = await startCallbackServer();
    try {
      const webUrl = getWebUrl(globalOpts.apiUrl);
      const loginUrl = `${webUrl}/auth/login?cli_port=${server.port}`;

      if (isInteractive() && !globalOpts.json) {
        console.log('');
        console.log(`  Opening your browser to sign in...`);
        console.log(`  ${pc.dim(loginUrl)}`);
        console.log('');
        console.log(
          `  ${pc.gray('If the browser does not open, paste the URL above. After signing in,')}`,
        );
        console.log(
          `  ${pc.gray('return here. Or run')} ${pc.blue('easl login --with-key easl_…')} ${pc.gray('with a key from the dashboard.')}`,
        );
        console.log('');
      }

      await openInBrowser(loginUrl);

      const result = await server.waitForKey();
      const email = result.email ?? (await verifyKey(result.apiKey, globalOpts));
      writeCredentials({
        apiKey: result.apiKey,
        keyId: result.keyId,
        email: email || undefined,
        createdAt: new Date().toISOString(),
      });
      finishLogin(email, globalOpts);
    } catch (err) {
      outputError(
        {
          message: err instanceof Error ? err.message : 'Login failed',
          code: 'login_error',
        },
        globalOpts,
      );
    } finally {
      server.close();
    }
  });

function finishLogin(email: string, globalOpts: GlobalOpts): void {
  if (globalOpts.json || !isInteractive()) {
    outputResult({ loggedIn: true, email: email || undefined }, globalOpts);
  } else {
    console.log('');
    console.log(
      `  ${pc.green('Signed in')}${email ? ` as ${pc.bold(email)}` : ''}`,
    );
    console.log(
      `  ${pc.gray('API key saved to ~/.config/easl/credentials.json')}`,
    );
    console.log('');
  }
}

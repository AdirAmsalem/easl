import * as p from '@clack/prompts';
import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { type GlobalOpts, apiRequest, getApiUrl, getWebUrl } from '../lib/client';
import { generateState, startCallbackServer } from '../lib/auth-server';
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
  .option(
    '--device',
    'Use the device flow (headless/remote machines): show a code to approve in any browser — no local callback port',
  )
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Opens your browser to sign in, then receives an API key on a local\ncallback port and saves it to ~/.config/easl/credentials.json (chmod 0600).\nThe key authenticates publishing private easls, sharing, and claiming.\nPrecedence: --api-key flag > EASL_API_KEY env > saved login.\n\nOn a headless or remote machine (e.g. over SSH) where a loopback callback\ncan’t reach you, use --device: easl prints a URL + code to approve in any\nbrowser, polls until you approve, then saves the key — no local port needed.',
      output: '  {"loggedIn":true,"email":"you@example.com"}',
      errorCodes: ['login_error'],
      examples: [
        'easl login',
        'easl login --device',
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

    // Device flow (headless / remote): no loopback callback. Show a URL + code to
    // approve in any browser, poll until approved, then exchange for an API key.
    if (opts.device) {
      await deviceLogin(globalOpts);
      return;
    }

    // Browser handshake: spin up a loopback callback server, open the sign-in page
    // with this server's port as `cli_port`, and wait for the minted key to arrive
    // on the callback. We pass only the port (not a loopback `next` URL): the worker
    // rebuilds the exact `http://127.0.0.1:<port>/callback` target server-side.
    //
    // After sign-in the worker's /auth/cli-callback GET renders a CONSENT page (it
    // mints NOTHING); the user must click Authorize, which POSTs same-origin with a
    // CSRF token and is the ONLY thing that mints the API key and redirects here.
    // The loopback `waitForKey` timeout (5 min) comfortably covers that extra click.
    // (A loopback `next` would be rejected by the worker's open-redirect guard.)
    //
    // A random `state` nonce binds the callback to THIS attempt: we send it as
    // `cli_state`, the worker echoes it back as `state`, and the loopback server
    // rejects any /callback whose state doesn't match — so a local page racing the
    // ephemeral port can't inject an attacker-owned key.
    const state = generateState();
    const server = await startCallbackServer(undefined, state);
    try {
      const webUrl = getWebUrl(globalOpts.apiUrl);
      const loginUrl = `${webUrl}/auth/login?cli_port=${server.port}&cli_state=${state}`;

      if (isInteractive() && !globalOpts.json) {
        console.log('');
        console.log(`  Opening your browser to sign in...`);
        console.log(`  ${pc.dim(loginUrl)}`);
        console.log('');
        console.log(
          `  ${pc.gray('After signing in, click')} ${pc.bold('Authorize')} ${pc.gray('on the consent page to')}`,
        );
        console.log(
          `  ${pc.gray('finish connecting this device, then return here.')}`,
        );
        console.log('');
        console.log(
          `  ${pc.gray('If the browser does not open, paste the URL above. Or run')}`,
        );
        console.log(
          `  ${pc.blue('easl login --with-key easl_…')} ${pc.gray('with a key from the dashboard.')}`,
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

/** OAuth device-flow client id (must match the worker's DEVICE_CLIENT_ID). */
const DEVICE_CLIENT_ID = 'easl-cli';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The next action when polling /auth/device/token. */
export type DeviceTokenOutcome =
  | { kind: 'token'; token: string }
  | { kind: 'pending' }
  | { kind: 'backoff' }
  | { kind: 'denied' }
  | { kind: 'expired' };

/**
 * Classify one `/auth/device/token` poll response into the next action.
 *
 * Only a DEFINITIVE terminal response is fatal: `expired_token` / `invalid_grant`
 * (the code is gone) or `access_denied`. Everything transient — a 429 rate limit,
 * a 5xx, `slow_down`, or any unrecognized error — yields `backoff`/`pending`, so the
 * CLI keeps polling instead of aborting the login. (Regression guard: a 429 mid-poll
 * must NOT kill the flow — that bug shipped once and is what this classifier exists
 * to pin down.)
 */
export function classifyDeviceTokenResponse(
  status: number,
  body: { access_token?: string; error?: string },
): DeviceTokenOutcome {
  if (status >= 200 && status < 300 && body.access_token) {
    return { kind: 'token', token: body.access_token };
  }
  if (status === 429 || status >= 500) return { kind: 'backoff' };
  if (body.error === 'slow_down') return { kind: 'backoff' };
  if (body.error === 'expired_token' || body.error === 'invalid_grant') {
    return { kind: 'expired' };
  }
  if (body.error === 'access_denied') return { kind: 'denied' };
  return { kind: 'pending' };
}

/**
 * OAuth 2.0 Device Authorization Grant (`easl login --device`).
 *
 * For headless/remote machines where the loopback browser handshake can't work
 * (the callback would hit the wrong box). There is NO local callback: we request a
 * device + user code, show the user a URL + code to approve in any browser, poll
 * the token endpoint until approved, then exchange the approved device session for
 * an `easl_` API key via /device/cli-key and save it. Works over SSH / in
 * containers, and an inbox-controlling agent can drive the approval unattended.
 */
async function deviceLogin(globalOpts: GlobalOpts): Promise<void> {
  const apiUrl = getApiUrl(globalOpts.apiUrl);
  const interactive = isInteractive() && !globalOpts.json;

  try {
    const codeRes = await fetch(`${apiUrl}/auth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: DEVICE_CLIENT_ID }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!codeRes.ok) throw new Error('Could not start device login. Try again.');
    const code = (await codeRes.json()) as DeviceCodeResponse;

    let intervalMs = Math.max(1, code.interval ?? 5) * 1000;
    const deadline = Date.now() + (code.expires_in ?? 600) * 1000;

    if (interactive) {
      console.log('');
      console.log(`  To sign in, open:   ${pc.underline(code.verification_uri)}`);
      console.log(`  and enter the code: ${pc.bold(code.user_code)}`);
      console.log('');
      console.log(`  ${pc.gray('Waiting for approval in your browser...')}`);
      console.log('');
      if (code.verification_uri_complete) await openInBrowser(code.verification_uri_complete);
    } else {
      // --json / non-interactive: announce the code on stderr so stdout carries
      // only the final result (and an orchestrating agent can read it to approve).
      console.error(
        `easl: approve this sign-in at ${code.verification_uri_complete ?? code.verification_uri} (code ${code.user_code})`,
      );
    }

    // Poll for approval until the code expires. Only a DEFINITIVE terminal
    // response (expired / denied / gone) aborts; transient conditions — network
    // blips, rate limits (429), server errors (5xx), or anything unrecognized —
    // just back off and keep polling, so a hiccup mid-flow doesn't fail the login.
    let accessToken: string | undefined;
    while (Date.now() < deadline) {
      await sleep(intervalMs);

      let tokenRes: Response;
      try {
        tokenRes = await fetch(`${apiUrl}/auth/device/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: DEVICE_GRANT_TYPE,
            device_code: code.device_code,
            client_id: DEVICE_CLIENT_ID,
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        continue; // network blip — keep polling
      }

      const data = (await tokenRes.json().catch(() => ({}))) as {
        access_token?: string;
        error?: string;
      };
      const outcome = classifyDeviceTokenResponse(tokenRes.status, data);
      if (outcome.kind === 'token') {
        accessToken = outcome.token;
        break;
      }
      if (outcome.kind === 'backoff') {
        intervalMs += 5000; // rate-limited / 5xx / slow_down — wait longer, keep polling
        continue;
      }
      if (outcome.kind === 'expired') {
        throw new Error('The sign-in code expired. Run `easl login --device` again.');
      }
      if (outcome.kind === 'denied') throw new Error('Sign-in was denied.');
      // 'pending' (the common case) or anything unrecognized → keep polling.
    }
    if (!accessToken) {
      throw new Error('Timed out waiting for approval. Run `easl login --device` again.');
    }

    // Exchange the approved device session for an easl_ API key.
    const keyRes = await fetch(`${apiUrl}/device/cli-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_token: accessToken }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!keyRes.ok) throw new Error('Could not finish sign-in. Try again.');
    const keyData = (await keyRes.json()) as { key: string; id?: string };

    let email = '';
    try {
      email = await verifyKey(keyData.key, globalOpts);
    } catch {
      // Non-fatal: the key works; we just couldn't fetch the email for display.
    }
    writeCredentials({
      apiKey: keyData.key,
      keyId: keyData.id,
      email: email || undefined,
      createdAt: new Date().toISOString(),
    });
    finishLogin(email, globalOpts);
  } catch (err) {
    outputError(
      { message: err instanceof Error ? err.message : 'Device login failed', code: 'login_error' },
      globalOpts,
    );
  }
}

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

import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { AddressInfo } from 'node:net';

/** Constant-time string compare (length-safe) for the state nonce check. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Default loopback host. Bound to 127.0.0.1 only — never exposed off-box. */
const CALLBACK_HOST = '127.0.0.1';

/** Path the browser handshake redirects back to with the minted API key. */
export const CALLBACK_PATH = '/callback';

/**
 * Generate a random, URL-safe state nonce for the login handshake. The CLI threads
 * it through the sign-in URL (`cli_state`), the worker echoes it back on the
 * loopback redirect (`state`), and this server rejects any /callback whose state
 * doesn't match — so a local page racing the ephemeral port during the login
 * window can't inject an attacker-owned key. base64url of 24 random bytes (32
 * chars) fits the worker's sanitizeCliState shape (`[A-Za-z0-9_-]{16,128}`).
 */
export function generateState(): string {
  return randomBytes(24).toString('base64url');
}

export interface CallbackResult {
  /** The full `easl_<…>` API key handed back by the browser handshake. */
  apiKey: string;
  /** Optional key id (for later revoke), if the handshake provided it. */
  keyId?: string;
  /** Optional account email, for display. */
  email?: string;
}

export interface CallbackServer {
  /** The loopback URL the browser is ultimately redirected to, e.g. http://127.0.0.1:51234/callback */
  callbackUrl: string;
  /**
   * The ephemeral loopback port. Passed to the sign-in page as `cli_port=<port>`;
   * the worker's /auth/cli-callback rebuilds the exact `http://127.0.0.1:<port>/callback`
   * target itself, so only the port (not a full URL) crosses the wire — and the
   * worker's general open-redirect guard never has to allow a loopback `next`.
   */
  port: number;
  /** Resolves once the browser hits the callback with a key (or rejects on timeout/abort). */
  waitForKey: () => Promise<CallbackResult>;
  /** Stop the server (idempotent). Always call in a finally. */
  close: () => void;
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signed in · easl</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:2rem 2.5rem;text-align:center;max-width:360px}
h1{font-size:1.125rem;margin:0 0 .5rem}p{color:#737373;font-size:.9rem;margin:0}</style></head>
<body><div class="card"><h1>You're signed in</h1><p>Return to your terminal — the easl CLI is ready.</p></div></body></html>`;

const ERROR_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in failed · easl</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:2rem 2.5rem;text-align:center;max-width:360px}
h1{font-size:1.125rem;margin:0 0 .5rem}p{color:#b91c1c;font-size:.9rem;margin:0}</style></head>
<body><div class="card"><h1>Sign-in failed</h1><p>No API key was provided. Return to your terminal and try again.</p></div></body></html>`;

/**
 * Start a loopback HTTP server to receive the API key from the browser sign-in
 * handshake.
 *
 * The browser is sent to the easl sign-in page with this server's `port` as
 * `cli_port`; once the user authenticates, the worker's /auth/cli-callback mints an
 * API key and redirects back to `http://127.0.0.1:<port>/callback?key=easl_…`
 * (optionally `&id=` and `&email=`). The server reads the key from the query string,
 * shows a success page, and resolves `waitForKey()`.
 *
 * Bound to 127.0.0.1 on an ephemeral port so nothing off the machine can reach it,
 * and the port is chosen by the OS to avoid collisions. `timeoutMs` bounds the
 * wait so a never-completed sign-in doesn't hang the CLI forever.
 *
 * `expectedState` (when provided) binds the callback to THIS login attempt: the
 * server rejects any /callback whose `state` query param doesn't match it. The
 * caller passes the same value to the sign-in page as `cli_state` and the worker
 * echoes it back, so a different local page that scans the ephemeral port and
 * fires its own /callback (with an attacker key but no/wrong state) is refused.
 */
export async function startCallbackServer(
  timeoutMs = 5 * 60_000,
  expectedState?: string,
): Promise<CallbackServer> {
  let resolveKey: (r: CallbackResult) => void;
  let rejectKey: (e: Error) => void;
  const keyPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveKey = resolve;
    rejectKey = reject;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${CALLBACK_HOST}`);
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    // Reject any response not tied to THIS login attempt. Checked BEFORE reading
    // the key so a mismatched-state request can never inject a credential — even a
    // page that races the ephemeral port and supplies a `key` is refused.
    if (expectedState) {
      const state = url.searchParams.get('state')?.trim();
      if (!state || !timingSafeEqualStr(state, expectedState)) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML);
        // Don't reject the wait: a stray/forged hit must not abort a still-pending
        // legitimate sign-in. The real callback (matching state) still resolves it;
        // the overall timeout bounds the wait if none ever arrives.
        return;
      }
    }
    const apiKey = url.searchParams.get('key')?.trim();
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ERROR_HTML);
      rejectKey(new Error('Sign-in handshake returned no API key'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SUCCESS_HTML);
    resolveKey({
      apiKey,
      keyId: url.searchParams.get('id')?.trim() || undefined,
      email: url.searchParams.get('email')?.trim() || undefined,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, CALLBACK_HOST, () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  const callbackUrl = `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`;

  const close = () => {
    if (timer) clearTimeout(timer);
    server.close();
  };

  return {
    callbackUrl,
    port,
    waitForKey: () => {
      timer = setTimeout(() => {
        rejectKey(new Error('Timed out waiting for browser sign-in'));
        server.close();
      }, timeoutMs);
      return keyPromise.finally(() => {
        if (timer) clearTimeout(timer);
      });
    },
    close,
  };
}

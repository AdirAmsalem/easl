import type { Context } from "hono";
import type { Env } from "../types";
import { makeAuth, AUTH_BASE_PATH, AuthSecretUnconfiguredError, authBaseURL, type EaslAuth } from "./index";
import { sanitizeCliState, sanitizeCliPort } from "./login";
import {
  CLI_CALLBACK_MARKER_TTL_MS,
  isBetterAuthSecretConfigured,
  parseCookieHeader,
  verifyCliCallbackMarker,
} from "../lib/session";
import { b64urlEncode, constantTimeEqual } from "../lib/crypto";

type Ctx = Context<{ Bindings: Env }>;

/**
 * The loopback callback path the `easl login` CLI server listens on (mirrors
 * lib/auth-server.ts CALLBACK_PATH). The CLI passes only the ephemeral PORT to the
 * worker (via `cli_port`); the host + path are fixed here so a forged `cli_port`
 * can never aim the redirect anywhere but the user's own machine.
 */
const LOOPBACK_PATH = "/callback";

/** Lifetime of the minted CLI API key: 90 days (bounds a leaked/over-minted key; re-login mints a fresh one). */
export const CLI_KEY_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Name of the SameSite=Strict double-submit CSRF cookie set when the consent page
 * is rendered and verified (equal to the hidden synchronizer field) on the
 * authorize POST. A cross-site page cannot set a cookie with this name on our
 * origin, so it cannot satisfy the double-submit half of the CSRF check.
 */
const CSRF_COOKIE_NAME = "easl_cli_csrf";

/** CSRF token lifetime: matches the marker TTL it rides alongside (15 min). */
const CSRF_TOKEN_TTL_MS = CLI_CALLBACK_MARKER_TTL_MS;

/** The fixed name every CLI-handshake key is minted under (see the mint below). */
export const CLI_KEY_NAME = "easl-cli";

/**
 * Atomically claim a CLI-callback marker nonce for single use. Returns true if THIS
 * request is the first to redeem it, false if already spent (a replay). Authority is
 * a D1 INSERT whose PRIMARY KEY is the nonce: SQLite serializes the write, so a second
 * INSERT of the same nonce fails the UNIQUE constraint (treated as spent).
 */
async function claimNonceAtomic(env: Env, nonce: string): Promise<boolean> {
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO "cli_handshake_nonce" ("nonce", "expires_at", "created_at") VALUES (?, ?, ?)`,
    )
      .bind(nonce, now + CLI_CALLBACK_MARKER_TTL_MS, now)
      .run();
  } catch (err) {
    // A UNIQUE/PK violation means the nonce was already redeemed → replay.
    console.log(JSON.stringify({ event: "cli_callback_nonce_claim_conflict", error: String(err) }));
    return false;
  }
  return true;
}

/**
 * Issue a single-use CSRF synchronizer token bound to the session and persist it
 * in D1. The token goes BOTH into the consent page (hidden field) AND a
 * SameSite=Strict cookie (double-submit). Stored server-side so it can be consumed
 * exactly once on the POST.
 */
async function issueCsrfToken(env: Env, sessionId: string): Promise<string> {
  const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO "cli_csrf_token" ("token", "session_id", "expires_at", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(token, sessionId, now + CSRF_TOKEN_TTL_MS, now)
    .run();
  return token;
}

/**
 * Atomically consume a CSRF synchronizer token for the given session. Returns true
 * only if a matching, unexpired, session-bound token existed and was deleted by
 * THIS call (single-use). Uses DELETE … RETURNING so the delete and the existence
 * check are one atomic statement — a second POST replaying the same token finds
 * nothing to delete and fails.
 */
async function consumeCsrfToken(env: Env, sessionId: string, token: string): Promise<boolean> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `DELETE FROM "cli_csrf_token" WHERE "token" = ? AND "session_id" = ? AND "expires_at" > ? RETURNING "token"`,
  )
    .bind(token, sessionId, now)
    .first<{ token: string }>();
  return Boolean(row);
}

/**
 * Build the exact `http://127.0.0.1:<port>/callback` target, reusing `sanitizeCliPort`
 * for validation. Returns null for a non-port. Host + path are fixed, so the port is
 * the only attacker-influenced input and can only ever name 127.0.0.1.
 */
export function loopbackCallbackUrl(port: string | null | undefined): string | null {
  const n = sanitizeCliPort(port);
  return n ? `http://127.0.0.1:${n}${LOOPBACK_PATH}` : null;
}

/**
 * Resolve the signed-in session (if any) from the cookie carried on this request.
 * Returns `{ id, email }` or null. Shared by the GET (consent page) and POST
 * (authorize) handlers so both decide "authenticated?" identically.
 */
async function resolveSession(
  auth: EaslAuth,
  c: Ctx,
): Promise<{ userId: string; sessionId: string; email: string } | null> {
  let session: { session?: { id?: unknown } | null; user?: { id?: unknown; email?: unknown } | null } | null;
  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers });
  } catch (err) {
    console.log(JSON.stringify({ event: "cli_callback_session_failed", error: String(err) }));
    return null;
  }
  if (!session?.user || typeof session.user.id !== "string") return null;
  const email = typeof session.user.email === "string" ? session.user.email : "";
  // Bind the CSRF token to the session id when better-auth surfaces it, else the
  // user id — both are stable across the GET→POST consent flow (same cookie), and
  // either way the token is bound to THIS authenticated principal.
  const sessionId = typeof session.session?.id === "string" ? session.session.id : session.user.id;
  return { userId: session.user.id, sessionId, email };
}

/**
 * GET /auth/cli-callback — render the same-origin CONSENT page. ZERO side effects
 * (mints no key, consumes no nonce); minting is deferred to the Authorize POST.
 *
 * Why the GET can't mint: the better-auth session cookie is SameSite=Lax, so it rides
 * a top-level cross-site GET; the `cb` marker is harvestable from the unauthenticated
 * login page; and a Sec-Fetch-Site check can't tell the attack from the genuine (also
 * cross-site) magic-link verify redirect. So the GET only (1) validates the marker
 * (signature+port+expiry; 403 if bad), (2) requires a session (else bounces to
 * /auth/login keeping cli_port/cli_state), and (3) renders a consent page bearing a
 * single-use CSRF synchronizer token (mirrored in a SameSite=Strict cookie) +
 * anti-clickjack headers. A cross-origin page can neither read the token (SOP) nor set
 * the Strict cookie, so only a genuine same-origin Authorize click reaches the mint.
 */
export async function handleCliCallback(c: Ctx): Promise<Response> {
  const port = c.req.query("port");
  const loopback = loopbackCallbackUrl(port);
  if (!loopback) {
    console.log(JSON.stringify({ event: "cli_callback_bad_port", port }));
    return c.json({ error: "Invalid or missing CLI callback port." }, 400);
  }
  // The normalized numeric string the marker was bound to (loopback non-null ⇒ valid).
  const normalizedPort = sanitizeCliPort(port)!;
  const cliState = sanitizeCliState(c.req.query("cli_state"));

  if (!isBetterAuthSecretConfigured(c.env.BETTER_AUTH_SECRET)) {
    console.error(JSON.stringify({ event: "cli_callback_secret_unconfigured" }));
    return c.json({ error: "Authentication is not configured." }, 503);
  }

  // Validate the worker-issued marker (signature + port + expiry). We do NOT consume
  // its nonce here — the GET has no side effects; single-use is enforced on the POST.
  const cb = c.req.query("cb");
  const markerResult = cb
    ? await verifyCliCallbackMarker(c.env.BETTER_AUTH_SECRET, normalizedPort, cb)
    : { valid: false as const };
  if (!markerResult.valid) {
    console.log(JSON.stringify({ event: "cli_callback_marker_invalid", hasMarker: Boolean(cb) }));
    return c.json({ error: "Invalid or missing login handshake token." }, 403);
  }

  let auth;
  try {
    auth = makeAuth(c.env);
  } catch (err) {
    if (err instanceof AuthSecretUnconfiguredError) {
      console.error(JSON.stringify({ event: "cli_callback_secret_unconfigured" }));
      return c.json({ error: "Authentication is not configured." }, 503);
    }
    throw err;
  }

  const session = await resolveSession(auth, c);
  if (!session) {
    // No session yet (e.g. cookie not set / expired). Send back to the sign-in page,
    // preserving cli_port/cli_state so a fresh magic link (with a NEW marker) routes
    // back through here.
    const back = new URL(`${AUTH_BASE_PATH}/login`, "http://internal");
    back.searchParams.set("cli_port", normalizedPort);
    if (cliState) back.searchParams.set("cli_state", cliState);
    console.log(JSON.stringify({ event: "cli_callback_no_session" }));
    return c.redirect(`${back.pathname}${back.search}`, 302);
  }

  // Authenticated: issue a single-use, session-bound CSRF synchronizer token and
  // render the consent page. NOTHING is minted here — minting requires the POST.
  let csrfToken: string;
  try {
    csrfToken = await issueCsrfToken(c.env, session.sessionId);
  } catch (err) {
    console.error(JSON.stringify({ event: "cli_callback_csrf_issue_failed", error: String(err) }));
    return c.json({ error: "Could not start the authorization. Try again." }, 500);
  }

  const html = consentPageHtml({
    actionPath: `${AUTH_BASE_PATH}/cli-callback`,
    port: normalizedPort,
    cb: cb!,
    cliState,
    csrfToken,
    email: session.email,
  });

  console.log(JSON.stringify({ event: "cli_callback_consent_rendered" }));
  return c.html(html, 200, {
    // The consent page is now the security boundary — never allow it to be framed
    // (clickjacking) and never let it be cached/reused (the CSRF token is single-use).
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    // Bind the double-submit CSRF cookie to the consent flow. SameSite=Strict so it
    // is NOT sent on cross-site requests — a forged cross-site POST cannot carry it.
    "Set-Cookie": csrfCookie(csrfToken),
  });
}

/**
 * POST /auth/cli-callback — the ONLY place a key is minted, reached only by the
 * consent page's same-origin Authorize submit. Mints + 303s to the loopback only when
 * ALL hold: a valid session; the CSRF synchronizer token matches the Strict
 * double-submit cookie AND is consumed atomically from D1 (single-use, session-bound);
 * and the `cb` marker re-verifies AND its nonce is claimed atomically (single-use).
 * Any failure → 403 (400 for a bad port), nothing minted. A cross-site attacker can't
 * satisfy the CSRF check (can't read the token or set the Strict cookie), so the Lax
 * session cookie riding a cross-site POST is not enough.
 */
export async function handleCliAuthorize(c: Ctx): Promise<Response> {
  if (!isBetterAuthSecretConfigured(c.env.BETTER_AUTH_SECRET)) {
    console.error(JSON.stringify({ event: "cli_authorize_secret_unconfigured" }));
    return c.json({ error: "Authentication is not configured." }, 503);
  }

  const form = await c.req.parseBody();
  const port = typeof form.port === "string" ? form.port : undefined;
  const loopback = loopbackCallbackUrl(port);
  if (!loopback) {
    console.log(JSON.stringify({ event: "cli_authorize_bad_port", port }));
    return c.json({ error: "Invalid or missing CLI callback port." }, 400);
  }
  const normalizedPort = sanitizeCliPort(port)!; // loopback non-null ⇒ valid
  const cliState = sanitizeCliState(typeof form.cli_state === "string" ? form.cli_state : undefined);
  const cb = typeof form.cb === "string" ? form.cb : undefined;
  const formCsrf = typeof form.csrf === "string" ? form.csrf : "";

  let auth;
  try {
    auth = makeAuth(c.env);
  } catch (err) {
    if (err instanceof AuthSecretUnconfiguredError) {
      console.error(JSON.stringify({ event: "cli_authorize_secret_unconfigured" }));
      return c.json({ error: "Authentication is not configured." }, 503);
    }
    throw err;
  }

  // ── Gate 1: session. Without it, never mint.
  const session = await resolveSession(auth, c);
  if (!session) {
    console.log(JSON.stringify({ event: "cli_authorize_no_session" }));
    return c.json({ error: "Not signed in." }, 403);
  }

  // ── Gate 2: CSRF. Double-submit (Strict cookie == hidden field) AND synchronizer
  // (the token exists in D1, bound to THIS session, and is consumed atomically). A
  // cross-site forgery can satisfy neither, so it is rejected here — before minting.
  const cookieCsrf = parseCookieHeader(
    c.req.header("cookie") ?? c.req.header("Cookie") ?? null,
    CSRF_COOKIE_NAME,
  );
  if (!formCsrf || !cookieCsrf || !constantTimeEqual(formCsrf, cookieCsrf)) {
    console.log(JSON.stringify({ event: "cli_authorize_csrf_double_submit_failed" }));
    return c.json({ error: "Invalid or missing authorization token." }, 403);
  }
  const csrfOk = await consumeCsrfToken(c.env, session.sessionId, formCsrf);
  if (!csrfOk) {
    // Token unknown / already used / not bound to this session / expired.
    console.log(JSON.stringify({ event: "cli_authorize_csrf_synchronizer_failed" }));
    return c.json({ error: "Invalid or expired authorization token." }, 403);
  }

  // ── Gate 3: marker re-verify + single-use nonce claim (atomic). The GET rendered
  // the consent page without consuming the nonce; the POST is where it is spent.
  const markerResult = cb
    ? await verifyCliCallbackMarker(c.env.BETTER_AUTH_SECRET, normalizedPort, cb)
    : { valid: false as const };
  if (!markerResult.valid || !markerResult.nonce) {
    console.log(JSON.stringify({ event: "cli_authorize_marker_invalid", hasMarker: Boolean(cb) }));
    return c.json({ error: "Invalid or missing login handshake token." }, 403);
  }
  const fresh = await claimNonceAtomic(c.env, markerResult.nonce);
  if (!fresh) {
    console.log(JSON.stringify({ event: "cli_authorize_marker_replay" }));
    return c.json({ error: "This login handshake was already used." }, 403);
  }

  // Mint the key server-side by replaying the cookie to better-auth's own
  // /api-key/create handler. The full key is returned exactly once, here, and handed
  // to the CLI via the loopback. Origin must match a trusted origin or better-auth's
  // CSRF guard rejects the POST. The key is SCOPED (named) and EXPIRING (expiresIn).
  const origin = authBaseURL(c.env);
  const cookie = c.req.header("cookie") ?? c.req.header("Cookie") ?? "";
  const createRes = await auth.handler(
    new Request(`${origin}${AUTH_BASE_PATH}/api-key/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, origin },
      body: JSON.stringify({ name: CLI_KEY_NAME, expiresIn: CLI_KEY_TTL_SECONDS }),
    }),
  );
  if (!createRes.ok) {
    console.error(JSON.stringify({ event: "cli_authorize_key_mint_failed", status: createRes.status }));
    return c.json({ error: "Could not create an API key for this session." }, 502);
  }
  const created = await createRes.json<{ id?: string; key?: string }>();
  if (!created.key) {
    console.error(JSON.stringify({ event: "cli_authorize_key_missing" }));
    return c.json({ error: "Could not create an API key for this session." }, 502);
  }

  const target = new URL(loopback);
  target.searchParams.set("key", created.key);
  if (created.id) target.searchParams.set("id", created.id);
  if (session.email) target.searchParams.set("email", session.email);
  // (session.email is the verified account email — echoed for the CLI to display.)
  // Echo the CLI's state nonce so its loopback server can confirm the response is
  // tied to THIS login attempt (rejecting an injected key from another page).
  if (cliState) target.searchParams.set("state", cliState);

  console.log(JSON.stringify({ event: "cli_authorize_redirect", hasId: Boolean(created.id) }));
  // 303 so the browser follows the loopback with a GET (POST → GET per RFC 7231).
  return c.redirect(target.toString(), 303);
}

/** Build the SameSite=Strict, HttpOnly double-submit CSRF cookie header value. */
function csrfCookie(token: string): string {
  return [
    `${CSRF_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Path=${AUTH_BASE_PATH}/cli-callback`,
    `Max-Age=${Math.ceil(CSRF_TOKEN_TTL_MS / 1000)}`,
  ].join("; ");
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The consent page. A plain HTML form (no auto-submit, no JS that submits): the
 * user must click Authorize. The hidden fields carry the marker (cb), port,
 * cli_state, and the single-use CSRF synchronizer token; the form POSTs same-origin
 * to /auth/cli-callback. All interpolated values are HTML-escaped.
 */
function consentPageHtml(opts: {
  actionPath: string;
  port: string;
  cb: string;
  cliState: string | null;
  csrfToken: string;
  email: string;
}): string {
  const { actionPath, port, cb, cliState, csrfToken, email } = opts;
  const emailLine = email
    ? `<p class="who">Signed in as <strong>${escapeHtml(email)}</strong></p>`
    : "";
  const stateField = cliState
    ? `<input type="hidden" name="cli_state" value="${escapeHtml(cliState)}">`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize the easl CLI</title>
<meta name="robots" content="noindex, nofollow">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
  .card{width:100%;max-width:420px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:2rem;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
  .lock{width:32px;height:32px;color:#737373;margin-bottom:1rem}
  h1{font-size:1.125rem;font-weight:600;margin-bottom:0.25rem}
  p.sub{color:#737373;font-size:0.875rem;margin-bottom:1.25rem}
  p.who{font-size:0.875rem;margin-bottom:1rem;color:#374151}
  ul{list-style:none;margin:0 0 1.5rem;padding:0.875rem 1rem;background:#f8f8f8;border:1px solid #ececec;border-radius:8px}
  ul li{font-size:0.8125rem;color:#374151;padding:0.2rem 0;display:flex;gap:0.5rem}
  ul li .k{color:#737373;min-width:5.5rem}
  ul li .v{font-weight:500;font-family:'SF Mono',Menlo,Consolas,monospace}
  button{width:100%;padding:0.625rem 1rem;background:#1a1a1a;color:#fff;border:none;border-radius:8px;font-size:0.9375rem;font-weight:500;cursor:pointer;transition:background 0.15s}
  button:hover{background:#404040}
  .hint{margin-top:0.875rem;font-size:0.75rem;color:#a3a3a3;text-align:center}
</style></head>
<body>
  <form class="card" method="POST" action="${escapeHtml(actionPath)}">
    <svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <h1>Authorize the easl CLI</h1>
    <p class="sub">Approve to sign in the easl CLI on this device.</p>
    ${emailLine}
    <ul>
      <li><span class="k">Action</span><span class="v">Create an API key for the easl CLI</span></li>
      <li><span class="k">Device port</span><span class="v">127.0.0.1:${escapeHtml(port)}</span></li>
    </ul>
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="cb" value="${escapeHtml(cb)}">
    <input type="hidden" name="port" value="${escapeHtml(port)}">
    ${stateField}
    <button type="submit">Authorize</button>
    <p class="hint">Only approve this if you just ran <code>easl login</code> in your terminal.</p>
  </form>
</body></html>`;
}

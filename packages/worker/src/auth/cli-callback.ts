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

/**
 * Lifetime of the minted CLI API key. Defense-in-depth: the handshake stops
 * minting NEVER-EXPIRING keys (the old behavior, which let a single CSRF mint an
 * unbounded permanent credential). 90 days balances "don't re-login constantly"
 * against bounding the blast radius of a leaked/over-minted key. Re-running
 * `easl login` mints a fresh key, so expiry is invisible in normal use.
 */
const CLI_KEY_TTL_SECONDS = 90 * 24 * 60 * 60;

/** KV key prefix for spent CLI-callback marker nonces (best-effort secondary cleanup). */
const CLI_NONCE_KV_PREFIX = "cli-cb-nonce:";

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
const CLI_KEY_NAME = "easl-cli";

/**
 * Max active CLI-handshake (`easl-cli`) keys to keep per account. After each
 * successful mint we revoke all but the newest, so the account never accumulates
 * more than this many CLI keys — the bound that turns "unbounded key sprawl" into
 * a fixed, self-rotating ceiling.
 *
 * Why 1: re-running `easl login` (the only legitimate way to reach this path)
 * always supersedes the prior CLI key, so a single newest key is all a user ever
 * needs.
 */
const MAX_ACTIVE_CLI_KEYS = 1;

type ApiKeyListEntry = { id?: unknown; name?: unknown; createdAt?: unknown };

/**
 * Revoke the account's older CLI-handshake keys, keeping only the newest
 * `MAX_ACTIVE_CLI_KEYS`. Runs after a fresh mint (the new key is the newest), so
 * with the cap at 1 every prior `easl-cli` key is revoked.
 *
 * Replays the session cookie to better-auth's own `/api-key/list` + `/api-key/delete`
 * (the same server-side-handler pattern as the mint). `/api-key/delete` enforces
 * `referenceId === session.user.id`, so it can only ever touch THIS session owner's
 * own keys. Best-effort: a failure here never blocks handing the freshly-minted key
 * back to the CLI (the mint already succeeded); we only log.
 */
async function pruneOldCliKeys(
  auth: EaslAuth,
  origin: string,
  cookie: string,
  keepKeyId: string | undefined,
): Promise<void> {
  try {
    const listRes = await auth.handler(
      new Request(`${origin}${AUTH_BASE_PATH}/api-key/list`, { headers: { cookie } }),
    );
    if (!listRes.ok) {
      console.log(JSON.stringify({ event: "cli_callback_prune_list_failed", status: listRes.status }));
      return;
    }
    const listed = await listRes.json<{ apiKeys?: ApiKeyListEntry[] }>();
    const cliKeys = (listed.apiKeys ?? [])
      .filter((k) => typeof k.id === "string" && k.name === CLI_KEY_NAME)
      .map((k) => ({ id: k.id as string, createdAt: toMillis(k.createdAt) }))
      // Newest first; the just-minted key sorts to the front so it survives.
      .sort((a, b) => b.createdAt - a.createdAt);

    // Always keep the freshly-minted key even if its createdAt ties an older one.
    const ordered = keepKeyId
      ? [...cliKeys.filter((k) => k.id === keepKeyId), ...cliKeys.filter((k) => k.id !== keepKeyId)]
      : cliKeys;

    const toRevoke = ordered.slice(MAX_ACTIVE_CLI_KEYS);
    for (const key of toRevoke) {
      const delRes = await auth.handler(
        new Request(`${origin}${AUTH_BASE_PATH}/api-key/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie, origin },
          body: JSON.stringify({ keyId: key.id }),
        }),
      );
      if (!delRes.ok) {
        console.log(JSON.stringify({ event: "cli_callback_prune_delete_failed", status: delRes.status }));
      }
    }
    if (toRevoke.length > 0) {
      console.log(JSON.stringify({ event: "cli_callback_keys_rotated", revoked: toRevoke.length }));
    }
  } catch (err) {
    // Best-effort: never let rotation failure block the handshake.
    console.log(JSON.stringify({ event: "cli_callback_prune_error", error: String(err) }));
  }
}

/** Coerce a better-auth `createdAt` (Date | ISO string | epoch) to epoch ms; 0 if unknown. */
function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Date.parse(value);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * Atomically claim a CLI-callback marker nonce for single use. Returns true if
 * THIS request is the first to redeem it, false if it was already spent (a replay).
 *
 * Atomicity (the open LOW being closed): the old check-then-put against KV had a
 * race — KV has no compare-and-set, so two concurrent redemptions of the same
 * marker could both read "absent" and both proceed. We now INSERT the nonce into
 * a D1 table whose PRIMARY KEY is the nonce; SQLite serializes the write and a
 * second INSERT of the same nonce fails the UNIQUE constraint. We treat any insert
 * failure as "already spent" (false) — the authority for single-use is the D1
 * uniqueness violation, not a prior read. KV TTL is kept only as best-effort
 * secondary cleanup (cheap negative cache), never as the gate.
 */
async function claimNonceAtomic(env: Env, nonce: string): Promise<boolean> {
  const now = Date.now();
  const expiresAt = now + CLI_CALLBACK_MARKER_TTL_MS;
  try {
    await env.DB.prepare(
      `INSERT INTO "cli_handshake_nonce" ("nonce", "expires_at", "created_at") VALUES (?, ?, ?)`,
    )
      .bind(nonce, expiresAt, now)
      .run();
  } catch (err) {
    // A UNIQUE/PK violation means the nonce was already redeemed → replay.
    console.log(JSON.stringify({ event: "cli_callback_nonce_claim_conflict", error: String(err) }));
    return false;
  }
  // Best-effort secondary cleanup: mark spent in KV too (TTL outlives the marker).
  // KV's minimum expirationTtl is 60s; the marker TTL is well above. A KV failure
  // is irrelevant — D1 already holds the authoritative single-use record.
  try {
    await env.SITES_KV.put(`${CLI_NONCE_KV_PREFIX}${nonce}`, "1", {
      expirationTtl: Math.ceil(CLI_CALLBACK_MARKER_TTL_MS / 1000) + 60,
    });
  } catch {
    /* ignore — D1 is the source of truth */
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
 * Validate the CLI loopback port and build the exact `http://127.0.0.1:<port>/callback`
 * target. Returns null for anything that isn't a plausible TCP port — the redirect
 * target is otherwise fully fixed (loopback host + path), so this is the ONLY
 * attacker-influenced input and it can only ever name a port on 127.0.0.1.
 */
export function loopbackCallbackUrl(port: string | null | undefined): string | null {
  if (!port || !/^\d{1,5}$/.test(port)) return null;
  const n = Number(port);
  if (n < 1 || n > 65535) return null;
  return `http://127.0.0.1:${n}${LOOPBACK_PATH}`;
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
 * GET /auth/cli-callback — render the same-origin CONSENT page (no side effects).
 *
 * The CLI opens `…/auth/login?cli_port=<port>&cli_state=<state>`; the login page
 * sends the magic-link with `callbackURL = /auth/cli-callback?port=<port>&cb=<marker>
 * &cli_state=<state>`. After the user clicks the emailed link, better-auth verifies
 * the token, sets the session cookie, and 302s the browser HERE with that cookie.
 *
 * Why a GET must NOT mint (the residual CSRF hole being closed): the better-auth
 * session cookie is `SameSite=Lax` with `Domain=.<DOMAIN>`, and Lax cookies ARE
 * sent on top-level cross-site GET navigations. The `cb` marker is the FIRST gate,
 * but it is mintable from the UNAUTHENTICATED login page, so an attacker can harvest
 * a valid 15-minute marker and lure a logged-in victim into a top-level cross-site
 * GET here, riding the victim's Lax cookie. A Sec-Fetch-Site/Origin check can't
 * distinguish that from the genuine magic-link verify redirect (also cross-site).
 *
 * So the GET has ZERO side effects: it mints no key and consumes no nonce. It only:
 *   1. validates the `cb` marker (signature + port + expiry) — a bogus request gets
 *      no consent page (403),
 *   2. requires a session — without one it bounces back to /auth/login preserving
 *      cli_port/cli_state (so a fresh magic link re-issues a new marker), and
 *   3. renders a consent page that requires an explicit, human Authorize click. The
 *      Authorize button submits a SAME-ORIGIN POST carrying a CSRF synchronizer
 *      token (also mirrored in a SameSite=Strict cookie). A cross-origin page can
 *      neither read the token (same-origin policy hides the page body) nor set the
 *      Strict cookie, so it cannot forge that POST — which is the ONLY thing that
 *      mints. The page is served X-Frame-Options: DENY + CSP frame-ancestors 'none'
 *      + Cache-Control: no-store so it cannot be framed/auto-clicked (clickjacking).
 */
export async function handleCliCallback(c: Ctx): Promise<Response> {
  const port = c.req.query("port");
  const loopback = loopbackCallbackUrl(port);
  if (!loopback) {
    console.log(JSON.stringify({ event: "cli_callback_bad_port", port }));
    return c.json({ error: "Invalid or missing CLI callback port." }, 400);
  }
  // port is the validated numeric string the marker was bound to (loopbackCallbackUrl
  // already enforced /^\d{1,5}$/ and 1..65535); use it verbatim for verification.
  const normalizedPort = String(Number(port));
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
 * POST /auth/cli-callback — the ONLY place a key is minted. Reached exclusively by
 * the consent page's Authorize button (a same-origin form submit).
 *
 * Mints + 303-redirects to the loopback ONLY when ALL hold:
 *   - a valid session rides in (same cookie the GET saw), and
 *   - the CSRF synchronizer token (hidden field) is present, matches the
 *     SameSite=Strict double-submit cookie, and is consumed atomically from D1
 *     (single-use, session-bound), and
 *   - the `cb` marker re-verifies (signature + port + expiry) AND its nonce is
 *     claimed atomically (single-use) — so a captured callbackURL can't be replayed.
 * Any failure → 403 (or 400 for a bad port) and NOTHING is minted.
 *
 * A cross-site attacker cannot satisfy the CSRF check: the synchronizer token lives
 * in a same-origin page body the SOP hides from them, and they cannot set the
 * Strict cookie on our origin. So even though the Lax session cookie would ride a
 * top-level cross-site POST, the request is rejected before any mint.
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
  const normalizedPort = sanitizeCliPort(port);
  if (!normalizedPort) {
    console.log(JSON.stringify({ event: "cli_authorize_bad_port", port }));
    return c.json({ error: "Invalid or missing CLI callback port." }, 400);
  }
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

  // Cap + rotate: revoke all but the newest `easl-cli` key for this account.
  await pruneOldCliKeys(auth, origin, cookie, created.id);

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

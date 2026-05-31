import type { Context } from "hono";
import type { Env } from "../types";
import { makeAuth, AUTH_BASE_PATH, AuthSecretUnconfiguredError, authBaseURL, type EaslAuth } from "./index";
import { sanitizeCliState } from "./login";
import {
  CLI_CALLBACK_MARKER_TTL_MS,
  isBetterAuthSecretConfigured,
  verifyCliCallbackMarker,
} from "../lib/session";

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

/** KV key prefix for spent CLI-callback marker nonces (single-use enforcement). */
const CLI_NONCE_KV_PREFIX = "cli-cb-nonce:";

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
 * needs. Crucially this also bounds the residual CSRF: the marker is minted by the
 * UNAUTHENTICATED login page, so an attacker who harvests a marker and rides a
 * logged-in victim's SameSite=Lax cookie here can still trip ONE mint per harvested
 * marker (the single-use nonce only stops re-firing the SAME marker). Capping +
 * rotating means each such mint REVOKES the previous CLI key instead of piling up —
 * the account holds at most one `easl-cli` key, so there is no key sprawl, only a
 * self-healing rotation of the (attacker-never-receives-it) CLI credential.
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
 * own keys — a harvested-marker CSRF can rotate the victim's own CLI key but never
 * reach another account's. Best-effort: a failure here never blocks handing the
 * freshly-minted key back to the CLI (the mint already succeeded); we only log.
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
 * Atomically-ish claim a CLI-callback marker nonce for single use. Returns true
 * if THIS request is the first to redeem it, false if it was already spent (a
 * replay). KV has no compare-and-set, but the marker is already single-flight in
 * practice (it rides one magic-link verify), and the nonce TTL (>= marker TTL)
 * closes the replay window; a check-then-put is sufficient belt-and-suspenders on
 * top of the signature + expiry gates.
 */
async function claimNonce(env: Env, nonce: string): Promise<boolean> {
  const key = `${CLI_NONCE_KV_PREFIX}${nonce}`;
  const existing = await env.SITES_KV.get(key);
  if (existing) return false;
  // TTL outlives the marker so a spent nonce can't be replayed within its own
  // validity window. KV's minimum expirationTtl is 60s; the marker TTL is well above.
  await env.SITES_KV.put(key, "1", { expirationTtl: Math.ceil(CLI_CALLBACK_MARKER_TTL_MS / 1000) + 60 });
  return true;
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
 * Complete the `easl login` browser handshake
 * (GET /auth/cli-callback?port=<port>&cb=<marker>[&cli_state=<state>]).
 *
 * The CLI opens `…/auth/login?cli_port=<port>&cli_state=<state>`; the login page
 * sends the magic-link with `callbackURL = /auth/cli-callback?port=<port>&cb=<marker>
 * &cli_state=<state>` (a root-relative, same-origin path sanitizeNext permits).
 * After the user clicks the emailed link, better-auth verifies the token, sets the
 * session cookie, and 302s the browser here WITH that cookie. This route then:
 *   1. VERIFIES the `cb` marker (worker-signed, bound to this port, single-use)
 *      and consumes its nonce, BEFORE doing anything with the session, then
 *   2. mints a SCOPED, EXPIRING `easl_<…>` API key for the now-authenticated
 *      session (server-side, via better-auth's own /api-key/create), and
 *   3. 302s the browser to the loopback
 *      `http://127.0.0.1:<port>/callback?key=…&id=…&email=…&state=<state>`
 *      so the waiting CLI server (auth-server.ts waitForKey) receives the key and
 *      can confirm `state` matches the value THIS login generated.
 *
 * SECURITY — defense in depth, because no single gate fully closes the CSRF here:
 * the better-auth session cookie is `SameSite=Lax` with `Domain=.<DOMAIN>`, and Lax
 * cookies ARE sent on top-level cross-site GET navigations. A Sec-Fetch-Site /
 * Origin check can NOT distinguish the attack from the real flow: the legitimate
 * redirect into this route arrives via the email-click → /magic-link/verify → 302
 * chain, which downgrades Sec-Fetch-Site to `cross-site` across the redirect chain
 * (per the Fetch Metadata spec) — identical to a lured cross-site navigation. So
 * the marker is the first gate: it is an HMAC the worker computes when it builds the
 * magic-link callbackURL, so a cross-site navigation that merely names this URL
 * carries no valid `cb` and is rejected (403) — no key is minted. The port binding
 * stops cross-handshake replay; the single-use nonce stops replay of a captured
 * marker; the key TTL bounds the blast radius of any over-mint.
 *
 * The residual hole the marker alone leaves: the marker is minted by the
 * UNAUTHENTICATED login page, so an attacker can harvest a fresh, valid marker per
 * attempt and trip ONE mint per harvest by riding a logged-in victim's Lax cookie
 * (the single-use nonce only blocks re-firing the SAME marker). We close the stated
 * harm — "unbounded key sprawl" — at two more layers: (1) login-page marker minting
 * is rate-limited per IP (see login.ts allowMarkerMint), throttling the harvest; and
 * (2) after each mint we cap + rotate the account's `easl-cli` keys to the newest
 * one (pruneOldCliKeys), so the account NEVER accumulates more than one CLI key —
 * each CSRF mint merely rotates the victim's own (attacker-never-receives-it) key
 * instead of piling up. The attacker never receives the key (it 302s to 127.0.0.1),
 * so this is a self-healing rotation nuisance, not key sprawl or takeover.
 *
 * This is the ONLY place a loopback redirect is allowed, and only to 127.0.0.1 on
 * a validated numeric port — the general open-redirect guard (login.ts sanitizeNext)
 * still rejects loopback `next` targets, so this dedicated, narrowly-scoped route is
 * what makes the headline browser flow work without widening that guard.
 *
 * Without a session (cookie missing/expired) it bounces back to the sign-in page,
 * re-attaching `cli_port`/`cli_state` so a retry still completes the handshake (a
 * fresh magic link there re-issues a new marker — the spent one is never reused).
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

  // ── Gate 1: verify the worker-issued, single-use state marker BEFORE anything
  // else. A cross-site GET riding only the Lax session cookie has no valid `cb`,
  // so it is rejected here and never reaches the key-minting path.
  if (!isBetterAuthSecretConfigured(c.env.BETTER_AUTH_SECRET)) {
    console.error(JSON.stringify({ event: "cli_callback_secret_unconfigured" }));
    return c.json({ error: "Authentication is not configured." }, 503);
  }
  const cb = c.req.query("cb");
  const markerResult = cb
    ? await verifyCliCallbackMarker(c.env.BETTER_AUTH_SECRET, normalizedPort, cb)
    : { valid: false as const };
  if (!markerResult.valid || !markerResult.nonce) {
    // No valid marker → this request was not initiated by the worker's own login
    // page for this port. Refuse to mint (the CSRF / key-sprawl defense).
    console.log(JSON.stringify({ event: "cli_callback_marker_invalid", hasMarker: Boolean(cb) }));
    return c.json({ error: "Invalid or missing login handshake token." }, 403);
  }
  // Single-use: redeem the nonce. A replayed marker (already spent) is refused so a
  // captured callbackURL can't be re-fired to mint a second key within its TTL.
  const fresh = await claimNonce(c.env, markerResult.nonce);
  if (!fresh) {
    console.log(JSON.stringify({ event: "cli_callback_marker_replay" }));
    return c.json({ error: "This login handshake link was already used." }, 403);
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

  // The session cookie set by magic-link verify rides in on this request.
  let session: { user?: { id?: unknown; email?: unknown } | null } | null;
  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers });
  } catch (err) {
    console.log(JSON.stringify({ event: "cli_callback_session_failed", error: String(err) }));
    session = null;
  }

  const email = typeof session?.user?.email === "string" ? session.user.email : "";
  if (!session?.user || typeof session.user.id !== "string") {
    // No session yet (e.g. cookie not set / expired). Send back to the sign-in page,
    // preserving cli_port/cli_state so a fresh magic link (with a NEW marker) routes
    // back through here. The marker just consumed above is single-use and not reused.
    const back = new URL(`${AUTH_BASE_PATH}/login`, "http://internal");
    back.searchParams.set("cli_port", normalizedPort);
    if (cliState) back.searchParams.set("cli_state", cliState);
    console.log(JSON.stringify({ event: "cli_callback_no_session" }));
    return c.redirect(`${back.pathname}${back.search}`, 302);
  }

  // Mint the key server-side by replaying the cookie to better-auth's own
  // /api-key/create handler (same path the e2e api-key lifecycle test drives). The
  // full key is returned exactly once, here, and handed to the CLI via the loopback.
  // Origin must match a trusted origin or better-auth's CSRF guard rejects the POST.
  // The key is SCOPED (named) and EXPIRING (expiresIn) — never a permanent key.
  const origin = authBaseURL(c.env);
  const cookie = c.req.header("cookie") ?? c.req.header("Cookie") ?? "";
  const createRes = await auth.handler(
    new Request(`${origin}${AUTH_BASE_PATH}/api-key/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, origin },
      body: JSON.stringify({ name: "easl-cli", expiresIn: CLI_KEY_TTL_SECONDS }),
    }),
  );
  if (!createRes.ok) {
    console.error(
      JSON.stringify({ event: "cli_callback_key_mint_failed", status: createRes.status }),
    );
    return c.json({ error: "Could not create an API key for this session." }, 502);
  }
  const created = await createRes.json<{ id?: string; key?: string }>();
  if (!created.key) {
    console.error(JSON.stringify({ event: "cli_callback_key_missing" }));
    return c.json({ error: "Could not create an API key for this session." }, 502);
  }

  // Cap + rotate: revoke all but the newest `easl-cli` key for this account. This
  // bounds key sprawl — the freshly minted key supersedes any prior CLI key, so a
  // logged-in victim lured here with a harvested marker (the residual CSRF: the
  // marker is minted by the unauthenticated login page) can only rotate the victim's
  // OWN single CLI key, never accumulate keys on the account. /api-key/delete
  // enforces ownership against the session, so this can't reach another account.
  await pruneOldCliKeys(auth, origin, cookie, created.id);

  const target = new URL(loopback);
  target.searchParams.set("key", created.key);
  if (created.id) target.searchParams.set("id", created.id);
  if (email) target.searchParams.set("email", email);
  // Echo the CLI's state nonce so its loopback server can confirm the response is
  // tied to THIS login attempt (rejecting an injected key from another page).
  if (cliState) target.searchParams.set("state", cliState);

  console.log(JSON.stringify({ event: "cli_callback_redirect", hasId: Boolean(created.id) }));
  return c.redirect(target.toString(), 302);
}

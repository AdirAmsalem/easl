import { b64urlDecode, b64urlEncode, constantTimeEqual } from "./crypto";

const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * The committed development placeholder. If this ever reaches production as the
 * live SESSION_SECRET, unlock cookies would be forgeable by anyone with the
 * source. `isSessionSecretConfigured` rejects it so private sites fail closed.
 */
export const PLACEHOLDER_SESSION_SECRET = "dev-only-replace-via-wrangler-secret-put-in-prod";

/**
 * True only when SESSION_SECRET is set to a real value (not unset, not the
 * committed placeholder, long enough to be a meaningful HMAC key). When false,
 * callers MUST fail closed rather than sign/verify with a weak/known key.
 */
export function isSessionSecretConfigured(secret: string | undefined | null): secret is string {
  return typeof secret === "string" && secret.length >= 16 && secret !== PLACEHOLDER_SESSION_SECRET;
}

/**
 * The committed development placeholder for BETTER_AUTH_SECRET (see
 * .dev.vars.example). If this reached production as the live secret, every
 * session, magic-link token, and API key would be forgeable by anyone with the
 * source. `isBetterAuthSecretConfigured` rejects it so auth fails closed.
 */
export const PLACEHOLDER_BETTER_AUTH_SECRET = "local-dev-better-auth-secret-change-me-please";

/**
 * better-auth's own hardcoded fallback secret. When BETTER_AUTH_SECRET is unset,
 * better-auth silently signs with this globally-known constant (its only guard,
 * validateSecret, throws solely when process.env.NODE_ENV === "production",
 * which this Worker never sets). We must reject it explicitly so auth fails
 * closed instead of minting forgeable credentials.
 */
export const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

/**
 * True only when BETTER_AUTH_SECRET is set to a real value: not unset, long
 * enough to be a meaningful key (>= 32 chars), and neither the committed
 * placeholder nor better-auth's hardcoded default fallback. When false, callers
 * MUST fail closed rather than boot the auth handler with a weak/known key.
 */
export function isBetterAuthSecretConfigured(secret: string | undefined | null): secret is string {
  return (
    typeof secret === "string" &&
    secret.length >= 32 &&
    secret !== PLACEHOLDER_BETTER_AUTH_SECRET &&
    secret !== BETTER_AUTH_DEFAULT_SECRET
  );
}

export type CookieOptions = {
  path?: string;
  domain?: string;
  maxAgeSeconds?: number;
};

/**
 * Derive a short, opaque fingerprint of the site's current password hash.
 * Binding this into the cookie means rotating the password (which changes the
 * stored hash) invalidates every previously-issued unlock cookie. The raw hash
 * is never placed in the cookie — only this HMAC-derived tag.
 */
export async function passwordFingerprint(secret: string, passwordHash: string | null): Promise<string> {
  const tag = await hmac(secret, `fp:${passwordHash ?? ""}`);
  return b64urlEncode(tag).slice(0, 16);
}

/**
 * Sign a cookie value tying it to a slug + password fingerprint for the given lifetime.
 * Format: `<b64url(slug|exp|fingerprint)>.<b64url(hmac)>`.
 */
export async function signCookie(secret: string, slug: string, fingerprint: string, ttlMs = COOKIE_TTL_MS): Promise<string> {
  const exp = Date.now() + ttlMs;
  const payload = `${slug}|${exp}|${fingerprint}`;
  const sig = await hmac(secret, payload);
  return `${b64urlEncode(new TextEncoder().encode(payload))}.${b64urlEncode(sig)}`;
}

/**
 * Verify a cookie against the expected slug + current password fingerprint. Returns `{ valid, exp? }`.
 * Invalid signatures, expired cookies, slug mismatches, and fingerprint mismatches
 * (i.e. the password was rotated since the cookie was issued) all return `{ valid: false }`.
 */
export async function verifyCookie(
  secret: string,
  slug: string,
  fingerprint: string,
  value: string,
): Promise<{ valid: boolean; exp?: number }> {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return { valid: false };
  const payloadB64 = value.slice(0, dot);
  const sigB64 = value.slice(dot + 1);
  const payloadBytes = b64urlDecode(payloadB64);
  const sigBytes = b64urlDecode(sigB64);
  if (!payloadBytes || !sigBytes) return { valid: false };
  const payload = new TextDecoder().decode(payloadBytes);
  const expectedSig = await hmac(secret, payload);
  if (!constantTimeEqual(b64urlEncode(sigBytes), b64urlEncode(expectedSig))) {
    return { valid: false };
  }
  // Payload fields never contain "|": slug is [a-z0-9-], exp is digits, fingerprint is b64url.
  const parts = payload.split("|");
  if (parts.length !== 3) return { valid: false };
  const [cookieSlug, expStr, cookieFp] = parts;
  if (cookieSlug !== slug) return { valid: false };
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp <= Date.now()) return { valid: false };
  if (!constantTimeEqual(cookieFp, fingerprint)) return { valid: false };
  return { valid: true, exp };
}

/** Parse a `Cookie` header and return the named value, or null if absent. */
export function parseCookieHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const raw of header.split(";")) {
    const part = raw.trim();
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

/** Build a `Set-Cookie` header value with safe defaults for private-site unlock cookies. */
export function buildSetCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Path=${opts.path ?? "/"}`,
    `Max-Age=${opts.maxAgeSeconds ?? Math.floor(COOKIE_TTL_MS / 1000)}`,
  ];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join("; ");
}

/** Build a Set-Cookie header that clears the named cookie. */
export function buildClearCookie(name: string, opts: Pick<CookieOptions, "path" | "domain"> = {}): string {
  const parts = [`${name}=`, "HttpOnly", "Secure", "SameSite=Lax", `Path=${opts.path ?? "/"}`, "Max-Age=0"];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join("; ");
}

export const SESSION_DEFAULT_TTL_MS = COOKIE_TTL_MS;

// ── Share tokens (private easls v2) ─────────────────────────────────────────
// A share token lets an owner grant a non-account-holder access through the
// ACCOUNT gate of a private site (it does NOT satisfy a password gate — a
// `private + password` site still prompts the recipient for the password).
//
// Stateless, no DB: it reuses the same HMAC machinery as the unlock cookie, so
// revocation is global only (rotate SESSION_SECRET). Format is identical in
// shape to the unlock cookie minus the password fingerprint:
//   `<b64url(slug|exp)>.<b64url(hmac)>`
// A token is bound to a single slug and carries its own expiry, so a leaked
// token can't be replayed against another site and lapses on its own.

/** Default share-token lifetime: 7 days (see the v2 plan's share-link defaults). */
export const SHARE_TOKEN_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Maximum share-token lifetime: 30 days. */
export const SHARE_TOKEN_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sign a share token granting account-gate access to `slug` for `ttlMs`.
 * Format: `<b64url(slug|exp)>.<b64url(hmac)>` (same shape as the unlock cookie,
 * without the password fingerprint). Returns `{ token, exp }` where `exp` is the
 * absolute expiry in epoch milliseconds, for the API to surface as `expiresAt`.
 */
export async function signShareToken(
  secret: string,
  slug: string,
  ttlMs = SHARE_TOKEN_DEFAULT_TTL_MS,
): Promise<{ token: string; exp: number }> {
  const exp = Date.now() + ttlMs;
  const payload = `${slug}|${exp}`;
  const sig = await hmac(secret, payload);
  const token = `${b64urlEncode(new TextEncoder().encode(payload))}.${b64urlEncode(sig)}`;
  return { token, exp };
}

/**
 * Verify a share token against the expected slug. Returns `{ valid, exp? }`.
 * Invalid signatures, expired tokens, and slug mismatches all return
 * `{ valid: false }`. Mirrors `verifyCookie` but with a two-field payload.
 */
export async function verifyShareToken(
  secret: string,
  slug: string,
  value: string,
): Promise<{ valid: boolean; exp?: number }> {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return { valid: false };
  const payloadB64 = value.slice(0, dot);
  const sigB64 = value.slice(dot + 1);
  const payloadBytes = b64urlDecode(payloadB64);
  const sigBytes = b64urlDecode(sigB64);
  if (!payloadBytes || !sigBytes) return { valid: false };
  const payload = new TextDecoder().decode(payloadBytes);
  const expectedSig = await hmac(secret, payload);
  if (!constantTimeEqual(b64urlEncode(sigBytes), b64urlEncode(expectedSig))) {
    return { valid: false };
  }
  // Payload fields never contain "|": slug is [a-z0-9-], exp is digits.
  const parts = payload.split("|");
  if (parts.length !== 2) return { valid: false };
  const [tokenSlug, expStr] = parts;
  if (tokenSlug !== slug) return { valid: false };
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp <= Date.now()) return { valid: false };
  return { valid: true, exp };
}

// ── CLI login-handshake state marker (private easls v2, Fix B) ──────────────
// A short-lived, worker-SIGNED marker that gates API-key minting at
// GET /auth/cli-callback. The login page (which the worker controls) mints it
// when it builds the magic-link `callbackURL`; the post-verify redirect carries
// it back to cli-callback, which verifies it BEFORE minting a key.
//
// Why this exists: the better-auth session cookie is `SameSite=Lax`, so a
// logged-in user lured to `api.<DOMAIN>/auth/cli-callback?port=N` via a
// top-level cross-site GET would otherwise mint an unbounded API key on the
// strength of that cookie alone (CSRF → key sprawl). A caller-supplied value is
// not enough — the marker is an HMAC the worker computes itself, so a cross-site
// navigation that simply names the URL carries no valid marker and is rejected.
//
// The marker is bound to the loopback `port` (so it can't be replayed against a
// different CLI handshake) and carries its own expiry. Single-use is enforced
// separately by consuming the embedded `nonce` in KV (see cli-callback.ts) — the
// nonce is returned by both sign + verify for that purpose.
// Format: `<b64url(cli|port|exp|nonce)>.<b64url(hmac)>`.

/** CLI-callback marker lifetime: 15 minutes — matches the magic-link TTL it rides. */
export const CLI_CALLBACK_MARKER_TTL_MS = 15 * 60 * 1000;

/**
 * Sign a single-use marker authorizing one `/auth/cli-callback?port=<port>` key
 * mint. Returns `{ marker, nonce, exp }`: `marker` goes into the magic-link
 * callbackURL, `nonce` is the single-use token to record in KV, `exp` is the
 * absolute expiry (epoch ms). `port` MUST be the normalized numeric string.
 */
export async function signCliCallbackMarker(
  secret: string,
  port: string,
  ttlMs = CLI_CALLBACK_MARKER_TTL_MS,
): Promise<{ marker: string; nonce: string; exp: number }> {
  const exp = Date.now() + ttlMs;
  const nonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(18)));
  const payload = `cli|${port}|${exp}|${nonce}`;
  const sig = await hmac(secret, payload);
  const marker = `${b64urlEncode(new TextEncoder().encode(payload))}.${b64urlEncode(sig)}`;
  return { marker, nonce, exp };
}

/**
 * Verify a CLI-callback marker against the expected `port`. Returns
 * `{ valid, nonce?, exp? }`. Invalid signatures, expired markers, and port
 * mismatches all return `{ valid: false }`. The caller is still responsible for
 * enforcing single-use by consuming `nonce` (a valid signature only proves the
 * worker issued the marker, not that it hasn't already been redeemed).
 */
export async function verifyCliCallbackMarker(
  secret: string,
  port: string,
  value: string,
): Promise<{ valid: boolean; nonce?: string; exp?: number }> {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return { valid: false };
  const payloadB64 = value.slice(0, dot);
  const sigB64 = value.slice(dot + 1);
  const payloadBytes = b64urlDecode(payloadB64);
  const sigBytes = b64urlDecode(sigB64);
  if (!payloadBytes || !sigBytes) return { valid: false };
  const payload = new TextDecoder().decode(payloadBytes);
  const expectedSig = await hmac(secret, payload);
  if (!constantTimeEqual(b64urlEncode(sigBytes), b64urlEncode(expectedSig))) {
    return { valid: false };
  }
  // Payload fields never contain "|": the literal "cli", a numeric port, a
  // numeric exp, and a b64url nonce.
  const parts = payload.split("|");
  if (parts.length !== 4) return { valid: false };
  const [tag, markerPort, expStr, nonce] = parts;
  if (tag !== "cli") return { valid: false };
  if (markerPort !== port) return { valid: false };
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp <= Date.now()) return { valid: false };
  if (!nonce) return { valid: false };
  return { valid: true, nonce, exp };
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return new Uint8Array(sig);
}

/** Cookie name for the unlock cookie of a given slug. */
export function unlockCookieName(slug: string): string {
  return `easl_pk_${slug}`;
}

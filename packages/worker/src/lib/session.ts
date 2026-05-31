import { b64urlDecode, b64urlEncode, constantTimeEqual } from "./crypto";

const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Committed dev placeholder. If it reached production as the live SESSION_SECRET,
 * unlock cookies would be forgeable by anyone with the source, so
 * `isSessionSecretConfigured` rejects it and private sites fail closed.
 */
export const PLACEHOLDER_SESSION_SECRET = "dev-only-replace-via-wrangler-secret-put-in-prod";

/** True only when SESSION_SECRET is a real key (set, >= 16 chars, not the placeholder). */
export function isSessionSecretConfigured(secret: string | undefined | null): secret is string {
  return typeof secret === "string" && secret.length >= 16 && secret !== PLACEHOLDER_SESSION_SECRET;
}

/** Committed dev placeholder for BETTER_AUTH_SECRET (see .dev.vars.example); rejected so auth fails closed. */
export const PLACEHOLDER_BETTER_AUTH_SECRET = "local-dev-better-auth-secret-change-me-please";

/**
 * better-auth's hardcoded fallback secret. When BETTER_AUTH_SECRET is unset it
 * silently signs with this globally-known constant (its validateSecret guard only
 * throws when NODE_ENV === "production", which this Worker never sets), so we must
 * reject it explicitly or every credential becomes forgeable.
 */
export const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

/**
 * True only when BETTER_AUTH_SECRET is a real key: set, >= 32 chars, and neither
 * the committed placeholder nor better-auth's hardcoded default fallback.
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

// ── Signed-token codec ──────────────────────────────────────────────────────
// Every token/cookie below shares one wire format: `<b64url(payload)>.<b64url(hmac)>`,
// where payload is `|`-joined fields. signPayload/verifyPayload own that
// construction + the constant-time HMAC check; each caller supplies/destructures
// its own fields and does its own per-field checks (slug/port match, expiry,
// fingerprint). Fields never contain "|" (slug is [a-z0-9-], port/exp are digits,
// fingerprints/nonces are b64url).

async function signPayload(secret: string, fields: (string | number)[]): Promise<string> {
  const payload = fields.join("|");
  const sig = await hmac(secret, payload);
  return `${b64urlEncode(new TextEncoder().encode(payload))}.${b64urlEncode(sig)}`;
}

/** Parse + HMAC-verify a signed value. Returns the split fields on a valid signature, else null. */
async function verifyPayload(secret: string, value: string, fieldCount: number): Promise<string[] | null> {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const payloadBytes = b64urlDecode(value.slice(0, dot));
  const sigBytes = b64urlDecode(value.slice(dot + 1));
  if (!payloadBytes || !sigBytes) return null;
  const payload = new TextDecoder().decode(payloadBytes);
  const expectedSig = await hmac(secret, payload);
  if (!constantTimeEqual(b64urlEncode(sigBytes), b64urlEncode(expectedSig))) return null;
  const parts = payload.split("|");
  return parts.length === fieldCount ? parts : null;
}

/** A short, opaque HMAC tag over `domain:data`, used to bind a token to mutable state. */
async function fingerprint(secret: string, domain: string, data: string): Promise<string> {
  return b64urlEncode(await hmac(secret, `${domain}:${data}`)).slice(0, 16);
}

/**
 * Fingerprint of the site's current password hash. Binding it into the unlock
 * cookie means rotating the password invalidates every previously-issued cookie.
 * The raw hash never enters the cookie — only this tag.
 */
export function passwordFingerprint(secret: string, passwordHash: string | null): Promise<string> {
  return fingerprint(secret, "fp", passwordHash ?? "");
}

/**
 * Sign an unlock cookie tying `slug` + password `fingerprint` for `ttlMs`.
 * Format: `<b64url(slug|exp|fingerprint)>.<b64url(hmac)>`.
 */
export async function signCookie(secret: string, slug: string, fingerprint: string, ttlMs = COOKIE_TTL_MS): Promise<string> {
  return signPayload(secret, [slug, Date.now() + ttlMs, fingerprint]);
}

/**
 * Verify an unlock cookie against the expected slug + current password fingerprint.
 * Bad signature, expiry, slug mismatch, or fingerprint mismatch (password rotated) → `{ valid: false }`.
 */
export async function verifyCookie(
  secret: string,
  slug: string,
  fingerprint: string,
  value: string,
): Promise<{ valid: boolean; exp?: number }> {
  return checkSlugToken(secret, slug, fingerprint, value);
}

/**
 * Shared verify for the `slug|exp|fingerprint` tokens (unlock cookie, share token,
 * share cookie): valid signature, slug match, unexpired, fingerprint match.
 */
async function checkSlugToken(
  secret: string,
  slug: string,
  fingerprint: string,
  value: string,
): Promise<{ valid: boolean; exp?: number }> {
  const parts = await verifyPayload(secret, value, 3);
  if (!parts) return { valid: false };
  const [tokenSlug, expStr, tokenFp] = parts;
  if (tokenSlug !== slug) return { valid: false };
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp <= Date.now()) return { valid: false };
  if (!constantTimeEqual(tokenFp, fingerprint)) return { valid: false };
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

/** Build a `Set-Cookie` header value with safe defaults for private-site cookies. */
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

// ── Share tokens & cookie (private easls v2) ────────────────────────────────
// A share token grants a non-account-holder access through the ACCOUNT gate of a
// private site (NOT a password gate — a `private + password` site still prompts
// for the password). Stateless (no DB; revoke only by rotating SESSION_SECRET).
// It is bound to a slug AND a site-instance fingerprint and carries its own
// expiry, so a leaked token can't be replayed against another site, doesn't
// survive a delete + re-publish that reuses the slug, and lapses on its own.
// Once a valid `?share=` is presented, the served response sets a short-lived,
// path-scoped share *cookie* (same value shape) so subresource/link requests that
// drop the query param still clear the account gate.

/** Default share-token lifetime: 7 days. */
export const SHARE_TOKEN_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Maximum share-token lifetime: 30 days. */
export const SHARE_TOKEN_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Fingerprint of a site INSTANCE (creation time + owner). A site deleted and
 * re-published under the same custom slug gets a new fingerprint, so an old share
 * URL for the prior site no longer authorizes the new one.
 */
export function shareFingerprint(
  secret: string,
  site: { createdAt: string; ownerId: string | null },
): Promise<string> {
  return fingerprint(secret, "share-fp", `${site.createdAt}|${site.ownerId ?? ""}`);
}

/**
 * Sign a share token for `slug` bound to the site-instance `fingerprint`. Returns
 * `{ token, exp }` (exp in epoch ms, for the API to surface as `expiresAt`).
 */
export async function signShareToken(
  secret: string,
  slug: string,
  fingerprint: string,
  ttlMs = SHARE_TOKEN_DEFAULT_TTL_MS,
): Promise<{ token: string; exp: number }> {
  const exp = Date.now() + ttlMs;
  return { token: await signPayload(secret, [slug, exp, fingerprint]), exp };
}

/** Verify a share token against the expected slug + current site-instance fingerprint. */
export function verifyShareToken(
  secret: string,
  slug: string,
  fingerprint: string,
  value: string,
): Promise<{ valid: boolean; exp?: number }> {
  return checkSlugToken(secret, slug, fingerprint, value);
}

/** Cookie name for the share grant of a slug (distinct from the password unlock cookie). */
export function shareCookieName(slug: string): string {
  return `easl_sh_${slug}`;
}

/** Sign a share-grant cookie (same value shape as the share token). */
export async function signShareCookie(secret: string, slug: string, fingerprint: string, ttlMs: number): Promise<string> {
  return signPayload(secret, [slug, Date.now() + ttlMs, fingerprint]);
}

/** Verify a share-grant cookie (identical to share-token verification). */
export function verifyShareCookie(
  secret: string,
  slug: string,
  fingerprint: string,
  value: string,
): Promise<{ valid: boolean; exp?: number }> {
  return checkSlugToken(secret, slug, fingerprint, value);
}

// ── CLI login-handshake marker (private easls v2) ───────────────────────────
// A short-lived, worker-SIGNED marker that gates API-key minting at
// GET /auth/cli-callback. The login page mints it into the magic-link callbackURL;
// the post-verify redirect carries it back to cli-callback, which verifies it
// before minting. It exists because the better-auth session cookie is SameSite=Lax:
// a logged-in user lured to cli-callback via a cross-site GET would otherwise mint
// a key on that cookie alone — but a cross-site nav carries no valid (worker-HMAC'd)
// marker. The marker is bound to the loopback `port` and carries its own expiry;
// single-use is enforced separately by consuming the embedded `nonce` (cli-callback.ts).
// Format: `<b64url(cli|port|exp|nonce)>.<b64url(hmac)>`.

/** CLI-callback marker lifetime: 15 minutes — matches the magic-link TTL it rides. */
export const CLI_CALLBACK_MARKER_TTL_MS = 15 * 60 * 1000;

/**
 * Sign a single-use marker authorizing one cli-callback key mint. Returns
 * `{ marker, nonce, exp }`: `marker` rides the callbackURL, `nonce` is recorded for
 * single-use, `exp` is epoch ms. `port` MUST be the normalized numeric string.
 */
export async function signCliCallbackMarker(
  secret: string,
  port: string,
  ttlMs = CLI_CALLBACK_MARKER_TTL_MS,
): Promise<{ marker: string; nonce: string; exp: number }> {
  const exp = Date.now() + ttlMs;
  const nonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(18)));
  return { marker: await signPayload(secret, ["cli", port, exp, nonce]), nonce, exp };
}

/**
 * Verify a CLI-callback marker against the expected `port`. A valid signature only
 * proves the worker issued it — the caller still enforces single-use via `nonce`.
 */
export async function verifyCliCallbackMarker(
  secret: string,
  port: string,
  value: string,
): Promise<{ valid: boolean; nonce?: string; exp?: number }> {
  const parts = await verifyPayload(secret, value, 4);
  if (!parts) return { valid: false };
  const [tag, markerPort, expStr, nonce] = parts;
  if (tag !== "cli" || markerPort !== port) return { valid: false };
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

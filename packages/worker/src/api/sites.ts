import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, SiteRow } from "../types";
import { siteUrl } from "../lib/url";
import { constantTimeEqual } from "../lib/crypto";
import { generatePassword, hashPassword } from "../lib/password";
import { getOptionalUser, type AuthUser } from "../auth/middleware";

const PASSWORD_MIN_LEN = 4;
const PASSWORD_MAX_LEN = 128;

const app = new Hono<{ Bindings: Env }>();

type Ctx = Context<{ Bindings: Env }>;

/**
 * Authorize a mutating site request via EITHER mechanism:
 *   - the anonymous `X-Claim-Token` (matches `sites.claim_token`), valid ONLY while
 *     the site is unowned (`owner_id` null), or
 *   - an owner session/Bearer key whose user id equals `sites.owner_id`.
 *
 * Once a site has been adopted into an account (`owner_id` set), the claim-token
 * path is rejected: claiming is "adopt into account" and a leaked/stale claim
 * token (it is returned by /publish and commonly stored in CLI config) must NOT
 * remain a parallel, un-revocable credential that can DELETE the site or flip its
 * privacy/ownership and thereby bypass the account gate. Owned sites are mutated
 * only by their owner's session/Bearer key.
 *
 * The X-Claim-Token branch is evaluated BEFORE resolving the optional user, so an
 * anonymous claim-token mutation (a v1 capability) never depends on better-auth
 * being configured — `getOptionalUser` (and therefore `makeAuth`) is only reached
 * when a claim token is absent or doesn't match.
 *
 * Returns `{ ok: true, via, user? }` when authorized, otherwise `{ ok: false }`
 * with the appropriate status (401 when no credential was supplied at all, 403
 * when a credential was supplied but matched neither). `user` is populated on the
 * owner path (and is null on the claim-token path) so callers that need the user
 * id (e.g. binding `owner_id` when promoting to account-private) can use it.
 */
async function authorizeSiteMutation(
  c: Ctx,
  site: SiteRow,
): Promise<
  | { ok: true; via: "claim-token" | "owner"; user: AuthUser | null }
  | { ok: false; status: 401 | 403; error: string }
> {
  const claimToken = c.req.header("X-Claim-Token");

  // Claim-token path — valid ONLY for unowned sites, and checked first so it never
  // depends on better-auth/getOptionalUser. Once owner_id is set, the token is dead
  // for mutations (an owned site is mutated only by its owner's session/Bearer).
  if (claimToken && !site.owner_id && constantTimeEqual(site.claim_token, claimToken)) {
    return { ok: true, via: "claim-token", user: null };
  }

  // Owner session path — the resolved user must own the site.
  const user = await getOptionalUser(c);
  if (user && site.owner_id && user.id === site.owner_id) {
    return { ok: true, via: "owner", user };
  }

  // A credential was supplied but matched neither → 403. Nothing supplied → 401.
  if (claimToken || user) {
    return { ok: false, status: 403, error: "Not authorized for this site" };
  }
  return { ok: false, status: 401, error: "Authentication required: X-Claim-Token header or owner session" };
}

// GET /sites/:slug — Get site metadata
app.get("/sites/:slug", async (c) => {
  const slug = c.req.param("slug");
  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE slug = ?")
    .bind(slug).first<SiteRow>();

  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  const versions = await c.env.DB.prepare(
    "SELECT id, status, created_at FROM versions WHERE slug = ? ORDER BY created_at DESC LIMIT 10"
  ).bind(slug).all();

  return c.json({
    slug: site.slug,
    title: site.title,
    template: site.template,
    url: siteUrl(c.req.url, c.env, site.slug),
    fileCount: site.file_count,
    totalBytes: site.total_bytes,
    expiresAt: site.expires_at,
    createdAt: site.created_at,
    // visibility is surfaced; the password hash (and the password) is NEVER returned.
    visibility: site.visibility ?? "public",
    versions: versions.results,
  });
});

// PATCH /sites/:slug/privacy — Toggle visibility / rotate password
//   Authorized via X-Claim-Token OR an owner session (better-auth cookie/Bearer).
//   Body: { private: boolean, password?: string }
//
//   The two privacy gates are independent and composable (see the v2 plan):
//   - `private: true` sets visibility=private. Reachable with a claim token alone
//     (no account required); a claim-token-only caller without a `password` gets a
//     server-generated one (v1 ergonomics — the password is then the only gate).
//   - The ACCOUNT gate is bound only when the caller is AUTHENTICATED: an
//     authenticated `private: true` additionally sets owner_id to the caller (and
//     must match the existing owner if one is set). A claim-token-only caller keeps
//     owner_id null, so the result is a pure password gate exactly as in v1.
//   - `password` (when supplied) sets/rotates the password gate regardless of path.
//   - `private: false` → clears visibility back to public, drops the password hash,
//     and (when authenticated) leaves ownership untouched.
app.patch("/sites/:slug/privacy", async (c) => {
  const slug = c.req.param("slug");

  let body: { private?: boolean; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body.private !== "boolean") {
    return c.json({ error: "`private` (boolean) is required" }, 400);
  }

  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE slug = ?")
    .bind(slug).first<SiteRow>();

  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  const auth = await authorizeSiteMutation(c, site);
  if (!auth.ok) {
    return c.json({ error: auth.error }, auth.status);
  }

  // Account gate: bound only when the caller is AUTHENTICATED. An authenticated
  // `private: true` adopts the site into the caller's account (owner_id = user.id);
  // a claim-token-only caller keeps owner_id null, so `private: true` yields a pure
  // password gate exactly as in v1. We never bind ownership on `private: false`.
  let ownerId = site.owner_id;
  if (body.private && auth.user) {
    if (site.owner_id && site.owner_id !== auth.user.id) {
      return c.json({ error: "Not authorized for this site" }, 403);
    }
    ownerId = auth.user.id;
  }

  // Password gate. When `private: true`:
  //   - caller-supplied password → set/rotate it.
  //   - no password supplied via the CLAIM-TOKEN path → generate one (v1 ergonomics:
  //     a claim-token-only lock has no account gate, so a password is the only gate).
  //   - no password supplied via the OWNER path → leave the password gate off; the
  //     account gate alone protects the site (owner can stack a password explicitly).
  // `private: false` drops the password hash (visibility goes public).
  let plaintextPassword: string | null = null;
  let passwordHash: string | null = null;
  if (body.private) {
    if (body.password != null) {
      if (typeof body.password !== "string"
        || body.password.length < PASSWORD_MIN_LEN
        || body.password.length > PASSWORD_MAX_LEN) {
        return c.json({ error: `password must be ${PASSWORD_MIN_LEN}-${PASSWORD_MAX_LEN} chars` }, 400);
      }
      plaintextPassword = body.password;
    } else if (auth.via === "claim-token") {
      plaintextPassword = generatePassword();
    }
    if (plaintextPassword != null) {
      passwordHash = await hashPassword(plaintextPassword);
    }
  } else if (body.password != null) {
    return c.json({ error: "password requires private: true" }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE sites SET visibility = ?, password_hash = ?, owner_id = ? WHERE slug = ?"
  ).bind(body.private ? "private" : "public", passwordHash, ownerId, slug).run();

  console.log(JSON.stringify({
    event: "site_privacy_changed",
    slug,
    visibility: body.private ? "private" : "public",
    passwordRotated: passwordHash !== null,
    via: auth.via,
    owned: ownerId != null,
  }));

  const response: Record<string, unknown> = {
    success: true,
    slug,
    visibility: body.private ? "private" : "public",
  };
  if (plaintextPassword != null) {
    response.password = plaintextPassword;
    response.passwordNotice = "This password is shown only once. Store it now — there's no recovery.";
  }
  return c.json(response);
});

// DELETE /sites/:slug — Delete site
//   Authorized via X-Claim-Token (anonymous sites) OR an owner session
//   (account-owned sites).
app.delete("/sites/:slug", async (c) => {
  const slug = c.req.param("slug");

  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE slug = ?")
    .bind(slug).first<SiteRow>();

  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  const auth = await authorizeSiteMutation(c, site);
  if (!auth.ok) {
    return c.json({ error: auth.error }, auth.status);
  }

  // Delete R2 files
  const versions = await c.env.DB.prepare("SELECT files_json FROM versions WHERE slug = ?")
    .bind(slug).all();

  const allR2Keys = versions.results.flatMap((version) => {
    const files = JSON.parse(version.files_json as string) as Array<{ r2Key: string }>;
    return files.map((f) => f.r2Key);
  });
  await Promise.all(allR2Keys.map((key) => c.env.CONTENT.delete(key)));

  // Delete from D1 (cascade deletes versions)
  await c.env.DB.prepare("DELETE FROM sites WHERE slug = ?").bind(slug).run();

  console.log(JSON.stringify({ event: "site_deleted", slug, files: allR2Keys.length, via: auth.via }));

  return c.json({ success: true, slug });
});

export default app;

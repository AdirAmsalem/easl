import { Hono } from "hono";
import type { Env, SiteRow } from "../types";
import { siteUrl } from "../lib/url";
import { getOptionalUser } from "../auth/middleware";
import {
  isSessionSecretConfigured,
  shareFingerprint,
  signShareToken,
  SHARE_TOKEN_DEFAULT_TTL_MS,
  SHARE_TOKEN_MAX_TTL_MS,
} from "../lib/session";

const app = new Hono<{ Bindings: Env }>();

const SHARE_TOKEN_DEFAULT_TTL_SECONDS = SHARE_TOKEN_DEFAULT_TTL_MS / 1000;
const SHARE_TOKEN_MAX_TTL_SECONDS = SHARE_TOKEN_MAX_TTL_MS / 1000;

// POST /sites/:slug/share-links — Mint a signed, expiring share link (owner-only).
//   Body: { expiresIn?: number /* seconds, default 7d, max 30d */ }
//   Response: { url, expiresAt, token }
//
//   Stateless HMAC (no DB row): the token is signed with SESSION_SECRET via the
//   Phase-2a `signShareToken` helper and satisfies the serve handler's ACCOUNT
//   gate only — a `private + password` site still prompts the recipient for the
//   password. Revocation is global (rotate SESSION_SECRET) until a stateful
//   share_links table is added.
app.post("/sites/:slug/share-links", async (c) => {
  const slug = c.req.param("slug");

  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE slug = ?")
    .bind(slug).first<SiteRow>();
  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  // Owner-only: the caller must be authenticated AND own the site. We do NOT
  // accept the claim token here — share links are an account-owner capability.
  const user = await getOptionalUser(c);
  if (!user) {
    return c.json({ error: "Authentication required. Sign in or pass a valid API key." }, 401);
  }
  if (!site.owner_id || site.owner_id !== user.id) {
    return c.json({ error: "Not authorized for this site" }, 403);
  }

  // Fail closed: without a real signing secret the token would be forgeable.
  if (!isSessionSecretConfigured(c.env.SESSION_SECRET)) {
    console.error(JSON.stringify({ event: "share_link_secret_unconfigured", slug }));
    return c.json({ error: "Share links are temporarily unavailable." }, 503);
  }

  let body: { expiresIn?: number } = {};
  try {
    const text = await c.req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  let ttlSeconds = SHARE_TOKEN_DEFAULT_TTL_SECONDS;
  if (body.expiresIn != null) {
    if (typeof body.expiresIn !== "number" || !Number.isFinite(body.expiresIn) || body.expiresIn <= 0) {
      return c.json({ error: "expiresIn must be a positive number of seconds" }, 400);
    }
    if (body.expiresIn > SHARE_TOKEN_MAX_TTL_SECONDS) {
      return c.json({ error: `expiresIn must be at most ${SHARE_TOKEN_MAX_TTL_SECONDS} seconds (30 days)` }, 400);
    }
    ttlSeconds = body.expiresIn;
  }

  // Bind the token to this site INSTANCE (created_at + owner_id) so it does not
  // survive a delete + re-publish that reuses the same custom slug.
  const fingerprint = await shareFingerprint(c.env.SESSION_SECRET, {
    createdAt: site.created_at,
    ownerId: site.owner_id,
  });
  const { token, exp } = await signShareToken(c.env.SESSION_SECRET, slug, fingerprint, ttlSeconds * 1000);
  const base = siteUrl(c.req.url, c.env, slug);
  const url = `${base}?share=${encodeURIComponent(token)}`;
  const expiresAt = new Date(exp).toISOString();

  console.log(JSON.stringify({ event: "share_link_created", slug, expiresAt }));

  return c.json({ url, expiresAt, token }, 201);
});

export default app;

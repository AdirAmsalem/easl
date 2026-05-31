import { Hono } from "hono";
import type { Env, SiteRow } from "../types";
import { siteUrl } from "../lib/url";
import { constantTimeEqual } from "../lib/crypto";
import { generatePassword, hashPassword } from "../lib/password";

const PASSWORD_MIN_LEN = 4;
const PASSWORD_MAX_LEN = 128;

const app = new Hono<{ Bindings: Env }>();

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
    visibility: site.visibility ?? "public",
    versions: versions.results,
  });
});

// PATCH /sites/:slug/privacy — Toggle visibility / rotate password (requires claim token)
//   Body: { private: boolean, password?: string }
//   - `private: true` without `password` → server generates and returns a new one
//   - `private: true` with `password` → uses caller-supplied password
//   - `private: false` → clears visibility back to public and drops the password hash
app.patch("/sites/:slug/privacy", async (c) => {
  const slug = c.req.param("slug");
  const claimToken = c.req.header("X-Claim-Token");

  if (!claimToken) {
    return c.json({ error: "X-Claim-Token header is required" }, 401);
  }

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

  if (!constantTimeEqual(site.claim_token, claimToken)) {
    return c.json({ error: "Invalid claim token" }, 403);
  }

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
    } else {
      plaintextPassword = generatePassword();
    }
    passwordHash = await hashPassword(plaintextPassword);
  } else if (body.password != null) {
    return c.json({ error: "password requires private: true" }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE sites SET visibility = ?, password_hash = ? WHERE slug = ?"
  ).bind(body.private ? "private" : "public", passwordHash, slug).run();

  console.log(JSON.stringify({
    event: "site_privacy_changed",
    slug,
    visibility: body.private ? "private" : "public",
    passwordRotated: passwordHash !== null,
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

// DELETE /sites/:slug — Delete site (requires claim token)
app.delete("/sites/:slug", async (c) => {
  const slug = c.req.param("slug");
  const claimToken = c.req.header("X-Claim-Token");

  if (!claimToken) {
    return c.json({ error: "X-Claim-Token header is required" }, 401);
  }

  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE slug = ?")
    .bind(slug).first<SiteRow>();

  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  if (!constantTimeEqual(site.claim_token, claimToken)) {
    return c.json({ error: "Invalid claim token" }, 403);
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

  console.log(JSON.stringify({ event: "site_deleted", slug, files: allR2Keys.length }));

  return c.json({ success: true, slug });
});

export default app;

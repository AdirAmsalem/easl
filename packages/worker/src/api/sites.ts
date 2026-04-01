import { Hono } from "hono";
import type { Env, SiteRow } from "../types";
import { siteUrl } from "../lib/url";

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
    versions: versions.results,
  });
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

  return c.json({ success: true, slug });
});

/** Constant-time string comparison to prevent timing attacks on tokens */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  // crypto.subtle.timingSafeEqual is available in Cloudflare Workers
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

export default app;

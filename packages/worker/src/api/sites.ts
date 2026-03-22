import { Hono } from "hono";
import type { Env, SiteRow } from "../types";

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
    url: `https://${site.slug}.${c.env.DOMAIN}`,
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

  if (site.claim_token !== claimToken) {
    return c.json({ error: "Invalid claim token" }, 403);
  }

  // Delete R2 files
  const versions = await c.env.DB.prepare("SELECT files_json FROM versions WHERE slug = ?")
    .bind(slug).all();

  for (const version of versions.results) {
    const files = JSON.parse(version.files_json as string) as Array<{ r2Key: string }>;
    for (const file of files) {
      await c.env.CONTENT.delete(file.r2Key);
    }
  }

  // Delete from D1 (cascade deletes versions)
  await c.env.DB.prepare("DELETE FROM sites WHERE slug = ?").bind(slug).run();

  // Delete from KV
  await c.env.SITES_KV.delete(`site:${slug}`);

  return c.json({ success: true, slug });
});

export default app;

import { Hono } from "hono";
import type { Env, CreateSiteRequest, InlinePublishRequest, SiteMeta, SiteRow } from "../types";
import { generateSlug, generateVersionId, generateClaimToken, isValidCustomSlug } from "../lib/slug";
import { generateUploadUrls } from "../lib/presign";
import { getContentType } from "../lib/mime";
import { siteUrl as buildSiteUrl, apiUrl as buildApiUrl } from "../lib/url";

const app = new Hono<{ Bindings: Env }>();

function siteUrl(c: { req: { url: string }; env: Env }, slug: string): string {
  return buildSiteUrl(c.req.url, c.env, slug);
}

function apiUrl(c: { req: { url: string }; env: Env }, path: string): string {
  return buildApiUrl(c.req.url, c.env, path);
}

const ANON_MAX_FILES = 50;
const ANON_MAX_SITE_SIZE = 200 * 1024 * 1024; // 200 MB per site
const ANON_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const UPLOAD_EXPIRY_SECONDS = 600; // 10 minutes
const INLINE_MAX_SIZE = 256 * 1024; // 256 KB

// POST /publish — Create new site
app.post("/publish", async (c) => {
  let body: CreateSiteRequest;
  try {
    body = await c.req.json<CreateSiteRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.files || body.files.length === 0) {
    return c.json({ error: "files array is required and must not be empty" }, 400);
  }

  if (body.files.length > ANON_MAX_FILES) {
    return c.json({ error: `Max ${ANON_MAX_FILES} files allowed` }, 400);
  }

  const totalSize = body.files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > ANON_MAX_SITE_SIZE) {
    return c.json({
      error: `Total size ${(totalSize / 1024 / 1024).toFixed(1)}MB exceeds limit of ${ANON_MAX_SITE_SIZE / 1024 / 1024}MB`,
    }, 400);
  }

  // Slug: custom or auto-generated with collision retry
  let slug: string;
  if (body.slug) {
    if (!isValidCustomSlug(body.slug)) {
      return c.json({ error: "Invalid slug: lowercase alphanumeric + hyphens, 3-48 chars" }, 400);
    }
    const existing = await c.env.DB.prepare("SELECT slug FROM sites WHERE slug = ?").bind(body.slug).first();
    if (existing) {
      return c.json({ error: "Slug already taken" }, 409);
    }
    slug = body.slug;
  } else {
    slug = await generateUniqueSlug(c.env.DB);
  }

  const versionId = generateVersionId();
  const claimToken = generateClaimToken();
  const now = new Date().toISOString();
  const ttlSeconds = body.ttl ?? ANON_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Insert site (INSERT OR FAIL catches race condition on custom slugs)
  try {
    await c.env.DB.prepare(
      `INSERT OR FAIL INTO sites (slug, title, template, claim_token, is_anonymous, created_at, expires_at, file_count, total_bytes)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).bind(slug, body.title ?? null, body.template ?? null, claimToken, now, expiresAt, body.files.length, totalSize).run();
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE constraint")) {
      return c.json({ error: "Slug already taken" }, 409);
    }
    throw e;
  }

  // Insert version
  const filesJson = JSON.stringify(body.files.map((f) => ({
    ...f,
    r2Key: `${slug}/${versionId}/${f.path}`,
  })));
  await c.env.DB.prepare(
    `INSERT INTO versions (id, slug, status, created_at, files_json) VALUES (?, ?, 'uploading', ?, ?)`
  ).bind(versionId, slug, now, filesJson).run();

  // Write KV metadata
  const meta: SiteMeta = {
    slug,
    currentVersionId: versionId,
    status: "pending",
    files: body.files,
    title: body.title ?? null,
    template: body.template ?? null,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  await c.env.SITES_KV.put(`site:${slug}`, JSON.stringify(meta), {
    expirationTtl: ttlSeconds + 3600,
  });

  // Generate presigned upload URLs
  const uploads = await generateUploadUrls(c.env, slug, versionId, body.files);

  return c.json({
    slug,
    url: siteUrl(c, slug),
    claimToken,
    upload: {
      versionId,
      uploads,
      finalizeUrl: apiUrl(c, `/finalize/${slug}`),
      expiresInSeconds: UPLOAD_EXPIRY_SECONDS,
    },
    expiresAt,
    anonymous: true,
  }, 201);
});

// POST /publish/inline — Inline content publish (one-call magic)
app.post("/publish/inline", async (c) => {
  let body: InlinePublishRequest;
  try {
    body = await c.req.json<InlinePublishRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.content || typeof body.content !== "string") {
    return c.json({ error: "content is required" }, 400);
  }

  if (body.content.length > INLINE_MAX_SIZE) {
    return c.json({ error: `Inline content exceeds ${INLINE_MAX_SIZE / 1024}KB limit. Use /publish for larger files.` }, 400);
  }

  if (!body.contentType) {
    return c.json({ error: "contentType is required" }, 400);
  }

  // Determine file extension from contentType
  const extMap: Record<string, string> = {
    "text/markdown": "md",
    "text/csv": "csv",
    "text/html": "index.html",
    "application/json": "data.json",
    "image/svg+xml": "image.svg",
    "text/plain": "content.txt",
    "text/x-mermaid": "diagram.mmd",
  };
  const ext = extMap[body.contentType.split(";")[0].trim()];
  const fileName = ext?.includes(".") ? ext : `content.${ext || "txt"}`;

  const slug = await generateUniqueSlug(c.env.DB);
  const versionId = generateVersionId();
  const claimToken = generateClaimToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ANON_TTL_SECONDS * 1000).toISOString();
  const contentBytes = new TextEncoder().encode(body.content);

  const fileEntry = {
    path: fileName,
    size: contentBytes.byteLength,
    contentType: body.contentType,
  };

  // Upload directly to R2
  const r2Key = `${slug}/${versionId}/${fileName}`;
  await c.env.CONTENT.put(r2Key, contentBytes, {
    httpMetadata: { contentType: body.contentType },
  });

  // Insert site
  await c.env.DB.prepare(
    `INSERT OR FAIL INTO sites (slug, title, template, claim_token, is_anonymous, created_at, expires_at, file_count, total_bytes)
     VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?)`
  ).bind(slug, body.title ?? null, body.template ?? null, claimToken, now, expiresAt, contentBytes.byteLength).run();

  // Insert version (already active since we uploaded directly)
  const filesJson = JSON.stringify([{ ...fileEntry, r2Key }]);
  await c.env.DB.prepare(
    `INSERT INTO versions (id, slug, status, created_at, files_json) VALUES (?, ?, 'active', ?, ?)`
  ).bind(versionId, slug, now, filesJson).run();

  // Write KV metadata (active immediately)
  const meta: SiteMeta = {
    slug,
    currentVersionId: versionId,
    status: "active",
    files: [fileEntry],
    title: body.title ?? null,
    template: body.template ?? null,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  await c.env.SITES_KV.put(`site:${slug}`, JSON.stringify(meta), {
    expirationTtl: ANON_TTL_SECONDS + 3600,
  });

  const url = siteUrl(c, slug);
  return c.json({
    url,
    slug,
    claimToken,
    ogImage: null,
    qrCode: `${url}/qr.svg`,
    embed: `<iframe src="${url}?embed=1" width="100%" height="500" frameborder="0"></iframe>`,
    shareText: `${body.title || fileName}: ${url}`,
    expiresAt,
    anonymous: true,
  }, 201);
});

// POST /finalize/:slug — Activate uploaded site
app.post("/finalize/:slug", async (c) => {
  const slug = c.req.param("slug");
  let body: { versionId: string };
  try {
    body = await c.req.json<{ versionId: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.versionId) {
    return c.json({ error: "versionId is required" }, 400);
  }

  // Verify version exists
  const version = await c.env.DB.prepare("SELECT * FROM versions WHERE id = ? AND slug = ?")
    .bind(body.versionId, slug).first();

  if (!version) {
    return c.json({ error: "Version not found" }, 404);
  }

  // Verify all files exist in R2
  const files = JSON.parse(version.files_json as string) as Array<{ path: string; r2Key: string }>;
  const checks = await Promise.all(
    files.map(async (file) => {
      const obj = await c.env.CONTENT.head(file.r2Key);
      return obj ? null : file.path;
    })
  );
  const missing = checks.filter((p): p is string => p !== null);

  if (missing.length > 0) {
    return c.json({ error: "Missing uploaded files", missing }, 422);
  }

  // Update version status
  await c.env.DB.prepare("UPDATE versions SET status = 'active' WHERE id = ?")
    .bind(body.versionId).run();

  // Update KV metadata to active
  const meta = await c.env.SITES_KV.get<SiteMeta>(`site:${slug}`, "json");
  if (!meta) {
    return c.json({ error: "Site metadata not found" }, 404);
  }

  if (meta.currentVersionId !== body.versionId) {
    return c.json({ error: "Version mismatch" }, 409);
  }

  meta.status = "active";
  meta.updatedAt = new Date().toISOString();
  await c.env.SITES_KV.put(`site:${slug}`, JSON.stringify(meta), {
    expirationTtl: meta.expiresAt
      ? Math.max(60, Math.floor((new Date(meta.expiresAt).getTime() - Date.now()) / 1000) + 3600)
      : undefined,
  });

  const url = siteUrl(c, slug);
  return c.json({
    url,
    slug,
    ogImage: null,
    qrCode: `${url}/qr.svg`,
    embed: `<iframe src="${url}?embed=1" width="100%" height="500" frameborder="0"></iframe>`,
    shareText: `Check out: ${url}`,
  });
});

async function generateUniqueSlug(db: D1Database, maxRetries = 3): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const slug = generateSlug();
    try {
      // Use a SELECT to check — the INSERT OR FAIL in the caller handles the race
      const existing = await db.prepare("SELECT slug FROM sites WHERE slug = ?").bind(slug).first();
      if (!existing) return slug;
    } catch {
      continue;
    }
  }
  throw new Error("Failed to generate unique slug after retries");
}

export default app;

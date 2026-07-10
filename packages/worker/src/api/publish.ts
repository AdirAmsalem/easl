import { Hono } from "hono";
import type { Env } from "../types";
import { generateSlug, generateVersionId, generateClaimToken, isValidCustomSlug } from "../lib/slug";
import { siteUrl as buildSiteUrl } from "../lib/url";
import { generateOgImage } from "../og";
import { generateQrSvg } from "../lib/qr";
import { generatePassword, hashPassword } from "../lib/password";
import { getOptionalUser } from "../auth/middleware";

const app = new Hono<{ Bindings: Env }>();

function siteUrl(c: { req: { url: string }; env: Env }, slug: string): string {
  return buildSiteUrl(c.req.url, c.env, slug);
}

const ANON_MAX_FILES = 50;
const ANON_MAX_SITE_SIZE = 200 * 1024 * 1024; // 200 MB per site
const ANON_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const SOCIAL_ASSET_BASE_PATH = "/_easl";

interface PublishFileEntry {
  path: string;
  content: string;
  contentType: string;
  encoding?: "base64";
}

interface PublishRequest {
  // Multi-file form
  files?: PublishFileEntry[];
  // Single-file shorthand
  content?: string;
  contentType?: string;
  // Shared
  title?: string;
  template?: string;
  ttl?: number;
  slug?: string;
  private?: boolean;
  password?: string;
  // Password gate, server-picks-the-secret variant. When `true` AND no explicit
  // `password` is supplied, the server mints a strong 4-word+4-digit password,
  // hashes it, and returns the plaintext ONCE in the response (v1 ergonomics).
  // Ignored when `password` is an explicit string (that takes precedence).
  generatePassword?: boolean;
}

const PASSWORD_MIN_LEN = 4;
const PASSWORD_MAX_LEN = 128;

// File extension mapping for single-file shorthand
const EXT_MAP: Record<string, string> = {
  "text/markdown": "md",
  "text/csv": "csv",
  "text/html": "index.html",
  "application/json": "data.json",
  "image/svg+xml": "image.svg",
  "text/plain": "content.txt",
  "text/x-mermaid": "diagram.mmd",
};

function fileNameFromContentType(contentType: string): string {
  const ext = EXT_MAP[contentType.split(";")[0].trim()];
  return ext?.includes(".") ? ext : `content.${ext || "txt"}`;
}

// POST /publish
app.post("/publish", async (c) => {
  let body: PublishRequest;
  try {
    body = await c.req.json<PublishRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Normalize: single-file shorthand → files array
  let files: PublishFileEntry[];
  if (body.content != null && body.contentType) {
    files = [{
      path: fileNameFromContentType(body.contentType),
      content: body.content,
      contentType: body.contentType,
    }];
  } else if (body.files && body.files.length > 0) {
    files = body.files;
  } else {
    return c.json({ error: "Provide either { content, contentType } or { files: [...] }" }, 400);
  }

  if (files.length > ANON_MAX_FILES) {
    return c.json({ error: `Max ${ANON_MAX_FILES} files allowed` }, 400);
  }

  // Validate all files have required fields
  for (const f of files) {
    if (!f.path || f.content == null || !f.contentType) {
      return c.json({ error: "Each file must have path, content, and contentType" }, 400);
    }
  }

  // Decode/encode all files and check total size
  let encoded: Array<PublishFileEntry & { bytes: Uint8Array }>;
  try {
    encoded = files.map((f) => ({
      ...f,
      bytes: f.encoding === "base64"
        ? Uint8Array.from(atob(f.content), (ch) => ch.charCodeAt(0))
        : new TextEncoder().encode(f.content),
    }));
  } catch {
    return c.json({ error: "Invalid base64 content" }, 400);
  }
  const totalSize = encoded.reduce((sum, f) => sum + f.bytes.byteLength, 0);

  if (totalSize > ANON_MAX_SITE_SIZE) {
    return c.json({
      error: `Total size ${(totalSize / 1024 / 1024).toFixed(1)}MB exceeds limit of ${ANON_MAX_SITE_SIZE / 1024 / 1024}MB`,
    }, 400);
  }

  // Slug: custom or auto-generated
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
    slug = await generateUniqueSlug(c.env.DB, body.title);
  }

  // Resolve OPTIONAL auth (session cookie OR Bearer API key). An authenticated
  // publish binds the site to the caller's account via `owner_id`; anonymous
  // publishing stays the zero-friction default for public + password-only sites.
  const user = await getOptionalUser(c);

  // ── Two independent, composable privacy gates (private easls v2) ───────────
  //  - ACCOUNT gate  (`private: true`): requires authentication. Binds owner_id
  //    and marks the site visibility=private. The serve handler then requires the
  //    owner's session (or a signed share link). Anonymous `private: true` → 401.
  //  - PASSWORD gate (`password` | `generatePassword`): a per-site password.
  //    Anonymous-publishable — this is v1's password-only mode, now decoupled from
  //    the `private` flag. Supply `password: "value"` to choose it, or
  //    `generatePassword: true` to have the server mint one and return it once.
  //  Both, either, or neither may be set; `private: true` + a password stacks them.
  const isPrivate = body.private === true;
  if (isPrivate && !user) {
    return c.json({ error: "private: true requires authentication. Sign in or pass a valid API key." }, 401);
  }

  // Password gate. Independent of the account gate, so a password works with or
  // without `private` and with or without authentication. Two ways to opt in:
  //   - explicit `password: "value"` → use it verbatim (validated for length).
  //   - `generatePassword: true` (and no explicit `password`) → the server mints
  //     a strong 4-word+4-digit password (v1 ergonomics, restored). The plaintext
  //     is returned ONCE below and never recoverable afterwards.
  // An explicit `password` always wins over `generatePassword` to avoid surprises.
  let plaintextPassword: string | null = null;
  let passwordHash: string | null = null;
  if (body.password != null) {
    if (typeof body.password !== "string"
      || body.password.length < PASSWORD_MIN_LEN
      || body.password.length > PASSWORD_MAX_LEN) {
      return c.json({ error: `password must be ${PASSWORD_MIN_LEN}-${PASSWORD_MAX_LEN} chars` }, 400);
    }
    plaintextPassword = body.password;
  } else if (body.generatePassword === true) {
    plaintextPassword = generatePassword();
  }
  if (plaintextPassword != null) {
    passwordHash = await hashPassword(plaintextPassword);
  }

  const versionId = generateVersionId();
  const claimToken = generateClaimToken();
  const now = new Date().toISOString();
  const ttlSeconds = body.ttl ?? ANON_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Upload all files to R2 via binding
  const filesMeta = encoded.map((f) => ({
    path: f.path,
    size: f.bytes.byteLength,
    contentType: f.contentType,
    r2Key: `${slug}/${versionId}/${f.path}`,
  }));

  await Promise.all(
    encoded.map((f, i) =>
      c.env.CONTENT.put(filesMeta[i].r2Key, f.bytes, {
        httpMetadata: { contentType: f.contentType },
      })
    )
  );

  // Insert site. An authenticated publish sets owner_id and flips is_anonymous off
  // so the site is owned by the caller's account from the start; anonymous publishes
  // keep owner_id null + is_anonymous 1 (claimable later via POST /sites/:slug/claim).
  const ownerId = user?.id ?? null;
  try {
    await c.env.DB.prepare(
      `INSERT OR FAIL INTO sites (slug, title, template, claim_token, is_anonymous, created_at, expires_at, file_count, total_bytes, visibility, password_hash, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      slug,
      body.title ?? null,
      body.template ?? null,
      claimToken,
      ownerId ? 0 : 1,
      now,
      expiresAt,
      files.length,
      totalSize,
      isPrivate ? "private" : "public",
      passwordHash,
      ownerId,
    ).run();
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE constraint")) {
      return c.json({ error: "Slug already taken" }, 409);
    }
    throw e;
  }

  // Insert version (active immediately)
  const filesJson = JSON.stringify(filesMeta);
  await c.env.DB.prepare(
    `INSERT INTO versions (id, slug, status, created_at, files_json) VALUES (?, ?, 'active', ?, ?)`
  ).bind(versionId, slug, now, filesJson).run();

  const url = siteUrl(c, slug);
  const contentTypes = [...new Set(files.map((f) => f.contentType))];
  console.log(JSON.stringify({
    event: "publish",
    slug,
    files: files.length,
    totalBytes: totalSize,
    contentTypes,
    visibility: isPrivate ? "private" : "public",
    owned: ownerId != null,
  }));

  // Skip OG/QR generation for any GATED site (account-private OR password-protected)
  // so content doesn't leak via a publicly-cached social image.
  const gated = isPrivate || passwordHash != null;
  if (!gated) {
    c.executionCtx.waitUntil(
      generateSocialAssets(c.env, slug, body.title || files[0].path, files[0].contentType, url)
    );
  }

  const response: Record<string, unknown> = {
    url,
    slug,
    claimToken,
    embed: `<iframe src="${url}?embed=1" width="100%" height="500" frameborder="0"></iframe>`,
    shareText: `${body.title || files[0].path}: ${url}`,
    expiresAt,
    anonymous: ownerId == null,
    visibility: isPrivate ? "private" : "public",
  };
  if (!gated) {
    response.ogImage = `${url}${SOCIAL_ASSET_BASE_PATH}/og.png`;
    response.qrCode = `${url}${SOCIAL_ASSET_BASE_PATH}/qr.svg`;
  }
  if (plaintextPassword != null) {
    response.password = plaintextPassword;
    response.passwordNotice = "This password is shown only once. Store it now — there's no recovery.";
  }
  return c.json(response, 201);
});

/** Generate OG image + QR code and upload to R2 (fire-and-forget via waitUntil) */
async function generateSocialAssets(
  env: Env,
  slug: string,
  title: string,
  contentType: string,
  siteUrlStr: string,
): Promise<void> {
  try {
    const [ogPng, qrSvg] = await Promise.all([
      generateOgImage({ title, slug, contentType, domain: env.DOMAIN }),
      Promise.resolve(generateQrSvg(siteUrlStr)),
    ]);
    await Promise.all([
      env.CONTENT.put(`og/${slug}.png`, ogPng, {
        httpMetadata: { contentType: "image/png" },
      }),
      env.CONTENT.put(`qr/${slug}.svg`, qrSvg, {
        httpMetadata: { contentType: "image/svg+xml" },
      }),
    ]);
  } catch (err) {
    console.error(JSON.stringify({ event: "social_asset_generation_failed", slug, error: String(err) }));
  }
}

async function generateUniqueSlug(db: D1Database, title?: string | null, maxRetries = 3): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const slug = generateSlug(title);
    try {
      const existing = await db.prepare("SELECT slug FROM sites WHERE slug = ?").bind(slug).first();
      if (!existing) return slug;
    } catch {
      continue;
    }
  }
  console.error(JSON.stringify({ event: "slug_generation_failed", maxRetries }));
  throw new Error("Failed to generate unique slug after retries");
}

export default app;

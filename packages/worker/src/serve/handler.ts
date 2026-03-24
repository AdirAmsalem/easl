import type { Env, SiteMeta, FileEntry } from "../types";
import { getContentType } from "../lib/mime";
import { detectViewerType, type ViewerType } from "../lib/mime";
import { decideRenderMode } from "../render/detect";
import { generateHtmlShell } from "../render/templates/base";

export async function serveSite(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  let meta = await env.SITES_KV.get<SiteMeta>(`site:${slug}`, "json");

  // D1 fallback: if KV missed (expired or evicted), rebuild from D1
  if (!meta) {
    meta = await rebuildMetaFromD1(env, slug);
  }

  if (!meta) {
    return htmlResponse(notFoundHtml(slug, env.DOMAIN), 404);
  }

  if (meta.expiresAt && new Date(meta.expiresAt) < new Date()) {
    return htmlResponse(expiredHtml(slug, env.DOMAIN), 410);
  }

  if (meta.status === "pending") {
    return htmlResponse(pendingHtml(slug), 202);
  }

  const url = new URL(request.url);
  const path = url.pathname.slice(1);

  // Render decision based on file manifest
  const decision = decideRenderMode(meta.files);

  // Root request — smart render
  if (!path || path === "") {
    // Passthrough mode (HTML site) → serve index.html directly
    if (decision.mode === "passthrough" && decision.primaryFile) {
      return serveR2File(env, slug, meta.currentVersionId, decision.primaryFile.path, request);
    }

    // Single file → smart render with beautiful viewer
    if (decision.mode === "single-file" && decision.primaryFile) {
      return smartRender(env, slug, meta, decision.primaryFile, decision.viewerType, request);
    }

    // Multi-file without index → auto-generated nav
    return htmlResponse(buildMultiFileNav(slug, meta, env.DOMAIN), 200);
  }

  // Specific file path requested
  const file = meta.files.find((f) => f.path === path);
  if (file) {
    // If requesting a raw file, check for ?render=true to smart-render it
    if (url.searchParams.has("render")) {
      const viewerType = detectViewerType(file.contentType, file.path);
      return smartRender(env, slug, meta, file, viewerType, request);
    }
    return serveR2File(env, slug, meta.currentVersionId, file.path, request);
  }

  // Try .html extension (clean URLs)
  const htmlFile = meta.files.find((f) => f.path === path + ".html");
  if (htmlFile) {
    return serveR2File(env, slug, meta.currentVersionId, htmlFile.path, request);
  }

  return htmlResponse(fileNotFoundHtml(path, slug, env.DOMAIN), 404);
}

const RENDER_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB — files larger than this skip smart render

async function smartRender(
  env: Env,
  slug: string,
  meta: SiteMeta,
  file: FileEntry,
  viewerType: ViewerType,
  request: Request,
): Promise<Response> {
  // Files >5MB skip smart render — serve as download instead of reading into memory
  if (file.size > RENDER_SIZE_LIMIT) {
    return serveR2File(env, slug, meta.currentVersionId, file.path, request);
  }

  // Check KV cache for rendered HTML
  const cacheKey = `html:${slug}:${meta.currentVersionId}:${file.path}`;
  const cached = await env.SITES_KV.get(cacheKey);
  if (cached) {
    return htmlResponse(cached, 200);
  }

  // Fetch file content from R2
  const r2Key = `${slug}/${meta.currentVersionId}/${file.path}`;
  const object = await env.CONTENT.get(r2Key);

  if (!object) {
    return htmlResponse(fileNotFoundHtml(file.path, slug, env.DOMAIN), 404);
  }

  const rawContent = await object.text();
  const title = meta.title || file.path;

  // Prepare data for the viewer
  let dataJson: string;
  if (viewerType === "csv" || viewerType === "markdown" || viewerType === "json" || viewerType === "svg" || viewerType === "mermaid") {
    // Text-based content: embed raw text
    dataJson = rawContent;
  } else if (viewerType === "image" || viewerType === "pdf" || viewerType === "download") {
    // Binary/reference content: embed URL reference
    dataJson = JSON.stringify({
      url: `/${file.path}`,
      path: file.path,
      contentType: file.contentType,
      size: file.size,
      title,
    });
  } else {
    dataJson = rawContent;
  }

  const html = generateHtmlShell({
    title,
    slug,
    domain: env.DOMAIN,
    contentType: file.contentType,
    viewerType,
    dataJson,
    template: meta.template,
  });

  // Cache for 1 hour
  await env.SITES_KV.put(cacheKey, html, { expirationTtl: 3600 });

  return htmlResponse(html, 200);
}

async function serveR2File(
  env: Env,
  slug: string,
  versionId: string,
  path: string,
  request: Request,
): Promise<Response> {
  const r2Key = `${slug}/${versionId}/${path}`;
  const object = await env.CONTENT.get(r2Key);

  if (!object) {
    return new Response("File not found", { status: 404 });
  }

  const contentType = getContentType(path);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "ETag": object.etag,
    ...getCacheHeaders(contentType),
  };

  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch && ifNoneMatch === object.etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}

/** Rebuild SiteMeta from D1 when KV has expired/evicted */
async function rebuildMetaFromD1(env: Env, slug: string): Promise<SiteMeta | null> {
  const site = await env.DB.prepare("SELECT * FROM sites WHERE slug = ?").bind(slug).first();
  if (!site) return null;

  const version = await env.DB.prepare(
    "SELECT * FROM versions WHERE slug = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).bind(slug).first();
  if (!version) return null;

  const files: FileEntry[] = JSON.parse(version.files_json as string).map(
    (f: { path: string; contentType: string; size: number }) => ({
      path: f.path,
      size: f.size,
      contentType: f.contentType,
    })
  );

  const meta: SiteMeta = {
    slug,
    currentVersionId: version.id as string,
    status: "active",
    files,
    title: site.title as string | null,
    template: site.template as string | null,
    expiresAt: site.expires_at as string | null,
    createdAt: site.created_at as string,
    updatedAt: site.created_at as string,
  };

  // Re-populate KV cache
  const ttl = meta.expiresAt
    ? Math.max(60, Math.floor((new Date(meta.expiresAt).getTime() - Date.now()) / 1000))
    : undefined;
  if (ttl === undefined || ttl > 0) {
    await env.SITES_KV.put(`site:${slug}`, JSON.stringify(meta), {
      expirationTtl: ttl ? ttl + 3600 : undefined,
    });
  }

  return meta;
}

function getCacheHeaders(contentType: string): Record<string, string> {
  if (contentType.startsWith("font/") || contentType === "application/wasm") {
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  }
  if (contentType.includes("text/html")) {
    return { "Cache-Control": "public, max-age=0, must-revalidate" };
  }
  return { "Cache-Control": "public, max-age=3600, s-maxage=86400" };
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildMultiFileNav(slug: string, meta: SiteMeta, domain: string): string {
  const title = meta.title || slug;
  const fileList = meta.files
    .map((f) => {
      const size = f.size < 1024 ? `${f.size} B`
        : f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(1)} KB`
        : `${(f.size / 1024 / 1024).toFixed(1)} MB`;
      return `<li><a href="/${f.path}?render">${escapeHtml(f.path)}</a> <span class="size">${size}</span></li>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,sans-serif;background:#fafafa;color:#1a1a1a;padding:2rem;line-height:1.6}
  .container{max-width:640px;margin:0 auto}
  h1{font-size:1.5rem;font-weight:600;margin-bottom:0.25rem}
  .meta{color:#737373;font-size:0.875rem;margin-bottom:2rem}
  .files{list-style:none}
  .files li{padding:0.75rem 0;border-bottom:1px solid #e5e5e5;display:flex;justify-content:space-between;align-items:center}
  .files a{color:#4f46e5;text-decoration:none;font-family:monospace;font-size:0.875rem}
  .files a:hover{text-decoration:underline}
  .size{color:#737373;font-size:0.75rem;font-family:monospace}
  .footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e5e5;color:#a3a3a3;font-size:0.75rem}
  .footer a{color:#a3a3a3;text-decoration:none}
  .footer a:hover{color:#4f46e5}
</style></head><body>
<div class="container">
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${meta.files.length} file${meta.files.length === 1 ? "" : "s"}</p>
  <ul class="files">${fileList}</ul>
  <div class="footer">Shared via <a href="https://${domain}">tinycloud</a></div>
</div></body></html>`;
}

function notFoundHtml(slug: string, domain: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title>
<style>body{font-family:-apple-system,sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.c{text-align:center}h1{font-size:4rem;font-weight:200}p{color:#737373;margin-top:1rem}a{color:#4f46e5;text-decoration:none}</style>
</head><body><div class="c"><h1>404</h1><p><strong>${escapeHtml(slug)}</strong> doesn't exist.</p><p><a href="https://${domain}">Create with tinycloud →</a></p></div></body></html>`;
}

function expiredHtml(slug: string, domain: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Expired</title>
<style>body{font-family:-apple-system,sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.c{text-align:center}h1{font-size:4rem;font-weight:200}p{color:#737373;margin-top:1rem}a{color:#4f46e5;text-decoration:none}</style>
</head><body><div class="c"><h1>410</h1><p><strong>${escapeHtml(slug)}</strong> has expired.</p><p>Anonymous sites expire after 7 days.</p><p><a href="https://${domain}">Create with tinycloud →</a></p></div></body></html>`;
}

function pendingHtml(slug: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deploying...</title>
<style>body{font-family:-apple-system,sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.c{text-align:center}h1{font-size:2rem;font-weight:400}p{color:#737373;margin-top:1rem}.spinner{width:40px;height:40px;border:3px solid #e5e5e5;border-top:3px solid #4f46e5;border-radius:50%;animation:spin 1s linear infinite;margin:1rem auto}@keyframes spin{to{transform:rotate(360deg)}}</style>
</head><body><div class="c"><div class="spinner"></div><h1>Deploying</h1><p><strong>${escapeHtml(slug)}</strong> is being set up.</p></div></body></html>`;
}

function fileNotFoundHtml(path: string, slug: string, domain: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title>
<style>body{font-family:-apple-system,sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.c{text-align:center}h1{font-size:4rem;font-weight:200}p{color:#737373;margin-top:1rem}code{background:#f0f0f0;padding:0.25rem 0.5rem;border-radius:4px;font-size:0.875rem}a{color:#4f46e5;text-decoration:none}</style>
</head><body><div class="c"><h1>404</h1><p><code>${escapeHtml(path)}</code> not found on <strong>${escapeHtml(slug)}</strong></p><p><a href="/">← Back</a></p></div></body></html>`;
}

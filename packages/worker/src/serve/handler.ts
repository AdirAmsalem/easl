import type { Env, SiteMeta, FileEntry } from "../types";
import { getContentType } from "../lib/mime";
import { detectViewerType, type ViewerType } from "../lib/mime";
import { decideRenderMode } from "../render/detect";
import { generateHtmlShell } from "../render/templates/base";
import { zipSync } from "fflate";

export async function serveSite(
  request: Request,
  env: Env,
  slug: string,
  ctx: ExecutionContext,
  basePath = "",
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: { "Content-Type": "text/plain" },
    });
  }

  const inner = await serveSiteInner(request, env, slug, ctx, basePath);
  // Cache API returns immutable responses — wrap to allow header mutation
  const response = new Response(inner.body, inner);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

async function serveSiteInner(
  request: Request,
  env: Env,
  slug: string,
  ctx: ExecutionContext,
  basePath = "",
): Promise<Response> {
  const meta = await loadMetaFromD1(env, slug);

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

  // Social assets — served from R2 at deterministic keys
  if (path === "_easl/og.png") {
    const obj = await env.CONTENT.get(`og/${slug}.png`);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" },
    });
  }
  if (path === "_easl/qr.svg") {
    const obj = await env.CONTENT.get(`qr/${slug}.svg`);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400, immutable" },
    });
  }

  // Download — serve raw file(s) as attachment
  if (path === "_easl/download") {
    const totalBytes = meta.files.reduce((sum, f) => sum + f.size, 0);
    console.log(JSON.stringify({ event: "download", slug, files: meta.files.length, totalBytes, zip: meta.files.length > 1 }));
    return downloadSite(env, slug, meta);
  }

  // Render decision based on file manifest
  const decision = decideRenderMode(meta.files);
  const logServe = (extra?: { cache?: "l1" | "l2" | "miss" }) =>
    console.log(JSON.stringify({ event: "serve", slug, path: path || "/", mode: decision.mode, viewerType: decision.viewerType, files: meta.files.length, ...extra }));

  // Root request — smart render
  if (!path || path === "") {
    // Passthrough mode (HTML site) → serve index.html directly
    if (decision.mode === "passthrough" && decision.primaryFile) {
      logServe();
      return serveR2File(env, slug, meta.currentVersionId, decision.primaryFile.path, request);
    }

    // Single file → smart render with beautiful viewer
    if (decision.mode === "single-file" && decision.primaryFile) {
      return smartRender(env, slug, meta, decision.primaryFile, decision.viewerType, request, ctx, basePath, logServe);
    }

    // Multi-file without index → auto-generated nav
    logServe();
    return htmlResponse(buildMultiFileNav(slug, meta, env.DOMAIN, basePath), 200);
  }

  // Specific file path requested
  const file = meta.files.find((f) => f.path === path);
  if (file) {
    // If requesting a raw file, check for ?render=true to smart-render it
    if (url.searchParams.has("render")) {
      const viewerType = detectViewerType(file.contentType, file.path);
      return smartRender(env, slug, meta, file, viewerType, request, ctx, basePath, logServe);
    }
    logServe();
    return serveR2File(env, slug, meta.currentVersionId, file.path, request);
  }

  // Try .html extension (clean URLs)
  const htmlFile = meta.files.find((f) => f.path === path + ".html");
  if (htmlFile) {
    logServe();
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
  ctx: ExecutionContext,
  basePath = "",
  logServe: (extra?: { cache?: "l1" | "l2" | "miss" }) => void = () => {},
): Promise<Response> {
  // Files >5MB skip smart render — serve as download instead of reading into memory
  if (file.size > RENDER_SIZE_LIMIT) {
    logServe();
    return serveR2File(env, slug, meta.currentVersionId, file.path, request);
  }

  // Check caches for rendered HTML (include basePath to avoid cache poisoning between routing modes)
  const cacheKey = `html:${slug}:${meta.currentVersionId}:${file.path}:${basePath || "root"}`;
  const cacheUrl = `https://cache.internal/${cacheKey}`;
  const cache = caches.default;

  // L1: Cache API (per-colo, ~1ms)
  const cacheMatch = await cache.match(cacheUrl);
  if (cacheMatch) {
    logServe({ cache: "l1" });
    return cacheMatch;
  }

  // L2: KV
  const cached = await env.SITES_KV.get(cacheKey);
  if (cached) {
    logServe({ cache: "l2" });
    const response = new Response(cached, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=14400",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
    ctx.waitUntil(cache.put(cacheUrl, response.clone()));
    return response;
  }

  logServe({ cache: "miss" });

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
    siteBaseUrl: basePath,
  });

  const response = new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=14400",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
  ctx.waitUntil(env.SITES_KV.put(cacheKey, html, { expirationTtl: 14400 }));
  ctx.waitUntil(cache.put(cacheUrl, response.clone()));

  return response;
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

async function loadMetaFromD1(env: Env, slug: string): Promise<SiteMeta | null> {
  let row;
  try {
    row = await env.DB.prepare(
      `SELECT s.title, s.template, s.expires_at, s.created_at,
              v.id AS version_id, v.files_json
       FROM sites s
       JOIN versions v ON v.slug = s.slug AND v.status = 'active'
       WHERE s.slug = ?
       ORDER BY v.created_at DESC
       LIMIT 1`
    ).bind(slug).first();
  } catch (err) {
    console.error(JSON.stringify({ event: "d1_query_failed", slug, error: String(err) }));
    throw err;
  }
  if (!row) return null;

  const files: FileEntry[] = JSON.parse(row.files_json as string).map(
    (f: { path: string; contentType: string; size: number }) => ({
      path: f.path,
      size: f.size,
      contentType: f.contentType,
    })
  );

  return {
    slug,
    currentVersionId: row.version_id as string,
    status: "active",
    files,
    title: row.title as string | null,
    template: row.template as string | null,
    expiresAt: row.expires_at as string | null,
    createdAt: row.created_at as string,
  };
}

async function downloadSite(env: Env, slug: string, meta: SiteMeta): Promise<Response> {
  const versionId = meta.currentVersionId;

  // Single file — serve directly as attachment
  if (meta.files.length === 1) {
    const file = meta.files[0];
    const r2Key = `${slug}/${versionId}/${file.path}`;
    const object = await env.CONTENT.get(r2Key);
    if (!object) return new Response("File not found", { status: 404 });
    const safeName = file.path.replace(/[^a-zA-Z0-9._-]/g, "_");
    return new Response(object.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  }

  // Multi-file — build zip
  const zipData: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  await Promise.all(
    meta.files.map(async (file) => {
      const r2Key = `${slug}/${versionId}/${file.path}`;
      const object = await env.CONTENT.get(r2Key);
      if (object) {
        zipData[file.path] = new Uint8Array(await object.arrayBuffer());
      } else {
        missing.push(file.path);
      }
    })
  );

  if (Object.keys(zipData).length === 0) {
    return new Response("No files available for download", { status: 404 });
  }

  const zipped = zipSync(zipData);
  return new Response(zipped, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}.zip"`,
    },
  });
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

function buildMultiFileNav(slug: string, meta: SiteMeta, domain: string, basePath = ""): string {
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
  .footer a{color:#a3a3a3;text-decoration:none;font-weight:500;transition:color 0.15s ease}
  .footer a:hover{color:#525252}
  .dl{display:inline-flex;align-items:center;gap:0.375rem;font-size:0.8125rem;font-weight:500;padding:0.375rem 0.75rem;background:#fff;color:#525252;border:1px solid #e5e5e5;border-radius:6px;text-decoration:none;transition:all 0.15s ease;vertical-align:middle}
  .dl:hover{background:#f9fafb;border-color:#d1d5db;color:#1a1a1a;box-shadow:0 1px 2px rgba(0,0,0,0.05)}
  .dl:active{transform:scale(0.97)}
  .dl svg{flex-shrink:0}
</style></head><body>
<div class="container">
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${meta.files.length} file${meta.files.length === 1 ? "" : "s"} · <a href="${basePath}/_easl/download" download class="dl"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8m0 0L5 7m3 3l3-3"/><path d="M3 13h10"/></svg>Download all</a></p>
  <ul class="files">${fileList}</ul>
  <div class="footer">Shared via <a href="https://${domain}" style="display:inline-flex;align-items:center;vertical-align:middle"><svg width="30" height="11" viewBox="100 540 820 260" aria-label="easl"><path fill="#a3a3a3" d="M220.826 577.724C227.438 577.408 237.227 577.677 243.82 578.438C273.565 581.811 300.745 596.882 319.36 620.326C338.155 644.2 344.884 670.205 341.322 700.043L229.806 700.058C207.333 700.096 182.568 700.708 160.326 700.05C174.546 754.979 251.573 765.662 286.557 724.715C288.024 722.998 290.641 718.899 292.622 718.294C299.889 717.868 307.173 717.765 314.45 717.984C320.342 718.197 330.549 718.906 336.266 718.175C333.166 729.219 327.356 738.512 320.285 747.304C272.925 806.197 171.626 801.991 133.008 735.576C125.302 722.324 120.99 709.817 119.46 694.593C112.996 630.277 158.592 583.423 220.826 577.724ZM160.554 662.226C169.612 661.736 179.889 661.966 189.056 661.973L236.625 661.972C256.989 662.089 277.436 661.693 297.775 662.109C291.387 644.913 278.364 631.001 261.628 623.492C249.988 618.218 236.199 616.238 223.5 617.241C194.855 619.904 170.475 634.123 160.554 662.226Z"/><path fill="#a3a3a3" d="M689.761 577.247C692.716 577.136 697 577.5 699.993 577.729C741.043 580.879 780.36 602.472 792.975 644.012C778.961 644.483 763.811 644.127 749.333 644.482L748.021 642.909C734.056 626.323 715.933 619.166 694.561 617.327C677.455 616.061 657.947 617.626 644.2 628.964C636.868 635.012 634.382 647.276 641.299 654.462C650.806 664.338 666.341 661.764 678.795 662.018C711.892 662.694 755.339 657.562 780.426 684.117C790.719 694.864 796.259 709.298 795.802 724.172C795.423 734.777 791.969 744.563 785.859 753.184C764.65 783.108 726.036 790.309 691.876 788.946C648.149 784.41 602.263 766.63 592.48 718.33L636.56 718.461C646.4 744.423 678.368 750.325 703.018 750.366C717.779 750.391 738.242 747.957 749.055 736.709C761.224 724.05 754.761 706.776 738.547 702.461C727.753 699.361 718.423 700.63 707.436 700.296C675.737 699.338 638.289 705.285 612.653 682.213C590.628 662.39 592.234 625.886 612.532 605.483C633.404 584.503 661.282 577.899 689.761 577.247Z"/><path fill="#93c5fd" d="M434.219 655.289C471.954 651.886 520.192 670.597 552.772 688.182C559.21 691.657 568.482 697.711 574.996 701.683L575.021 742.276C564.144 738.86 546.817 729.056 537.4 722.859C509.896 704.761 479.635 693.447 446.468 692.519C431.053 692.088 413.208 695.456 401.673 706.814C392.932 715.42 388.007 729.292 398.883 738.72C410.55 748.908 426.455 751.15 441.375 750.619C460.849 750.54 482.316 743.173 497.244 730.784C500.454 728.12 504.61 724.013 508.896 723.537C517.111 722.623 525.68 729.819 526.627 737.968C527.489 745.003 524.767 751.398 520.328 756.596C502.558 777.402 474.599 786.018 448.213 788.598C420.786 791.182 396.267 786.606 374.789 768.568C362.418 758.179 354.487 744.901 353.237 728.641C352.131 713.16 357.237 697.875 367.426 686.166C383.825 667.012 409.498 657.125 434.219 655.289Z"/><path fill="#a3a3a3" d="M811.525 516.938C824.936 516.755 838.62 516.898 852.051 516.912L852.075 628.471C852.065 649.662 852.03 670.866 852.096 692.056C852.145 707.866 855.694 723.362 867.488 734.713C878.636 745.442 892.013 746.204 906.59 745.964C906.205 755.776 906.955 774.977 906.486 785.544C906.272 785.792 906.058 786.04 905.845 786.287L905.347 786.29C878.306 786.293 855.491 778.408 836.339 759.11C826.04 748.895 818.691 736.088 815.069 722.041C810.98 705.573 811.532 688.148 811.575 671.292L811.642 630.776L811.525 516.938Z"/><path fill="#a3a3a3" d="M457.03 577.214C484.009 575.295 514.229 588.818 535.439 604.847L535.864 579.219C547.39 579.161 563.973 578.524 575.063 579.248L575.036 686.201C565.625 681.195 546.933 670.805 537.504 667.685C531.737 655.34 526.826 647.581 516.966 638.292C515.073 636.741 513.158 635.216 511.224 633.716C493.977 620.596 469.782 614.36 448.399 617.563C425.812 620.946 412.416 630.709 399.123 648.363C394.312 647.771 387.135 648.59 382.083 648.489C373.864 648.324 365.773 648.097 357.552 648.219C359.926 635.727 367.314 623.295 375.725 613.908C396.249 591.003 426.632 578.798 457.03 577.214Z"/><path fill="#a3a3a3" d="M535.63 738.116C538.522 739.311 545.22 743.277 548.292 744.923C557.656 749.938 564.884 752.996 575.046 755.811L575.053 786.438C563.191 785.901 547.997 786.373 535.901 786.453C535.889 773.031 536.716 750.963 535.63 738.116Z"/></svg></a></div>
</div></body></html>`;
}

function notFoundHtml(slug: string, domain: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title>
<style>body{font-family:-apple-system,sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.c{text-align:center}h1{font-size:4rem;font-weight:200}p{color:#737373;margin-top:1rem}a{color:#4f46e5;text-decoration:none}</style>
</head><body><div class="c"><h1>404</h1><p><strong>${escapeHtml(slug)}</strong> doesn't exist.</p><p><a href="https://${domain}">Create with easl →</a></p></div></body></html>`;
}

function expiredHtml(slug: string, domain: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Expired</title>
<style>body{font-family:-apple-system,sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.c{text-align:center}h1{font-size:4rem;font-weight:200}p{color:#737373;margin-top:1rem}a{color:#4f46e5;text-decoration:none}</style>
</head><body><div class="c"><h1>410</h1><p><strong>${escapeHtml(slug)}</strong> has expired.</p><p>Anonymous sites expire after 7 days.</p><p><a href="https://${domain}">Create with easl →</a></p></div></body></html>`;
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

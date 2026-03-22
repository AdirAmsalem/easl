import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import publishApi from "./api/publish";
import sitesApi from "./api/sites";
import { serveSite } from "./serve/handler";

// ─────────────────────────────────────────────
// tinycloud — Beautiful auto-rendering for agent output
// ─────────────────────────────────────────────

const api = new Hono<{ Bindings: Env }>();

api.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Claim-Token"],
  maxAge: 86400,
}));

api.get("/", (c) => c.json({
  name: "tinycloud",
  version: "0.1.0",
  description: "Agent-native hosting with beautiful auto-rendering",
  docs: `https://${c.env.DOMAIN}/docs`,
  status: "operational",
}));

api.get("/health", (c) => c.json({ ok: true }));

api.route("/", publishApi);
api.route("/", sitesApi);

api.all("/*", (c) => c.json({ error: "Not found", docs: `https://${c.env.DOMAIN}/docs` }, 404));

// ─────────────────────────────────────────────
// Main Worker — route by hostname
// ─────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const path = url.pathname;

    const html = (body: string) =>
      new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

    // Local development — path-based routing
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const apiPrefixes = ["/publish", "/finalize", "/sites", "/health"];
      if (apiPrefixes.some((p) => path === p || path.startsWith(p + "/"))) {
        return api.fetch(request, env, ctx);
      }
      return html(landingPageHtml(env.DOMAIN));
    }

    // API subdomain
    if (hostname === env.API_HOST) {
      return api.fetch(request, env, ctx);
    }

    // Root domain → landing page
    if (hostname === env.DOMAIN || hostname === `www.${env.DOMAIN}`) {
      return html(landingPageHtml(env.DOMAIN));
    }

    // Wildcard subdomain → serve site with smart rendering
    const domainSuffix = `.${env.DOMAIN}`;
    if (hostname.endsWith(domainSuffix)) {
      const slug = hostname.slice(0, -domainSuffix.length);
      if (slug && !slug.includes(".")) {
        return serveSite(request, env, slug);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

// ─────────────────────────────────────────────
// Landing page
// ─────────────────────────────────────────────

function landingPageHtml(domain: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tinycloud — Make agent output beautiful</title>
  <meta name="description" content="Upload a file, get a beautiful shareable URL. CSV becomes an interactive table. Markdown becomes a styled page. Built for AI agents.">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fafafa;color:#1a1a1a;line-height:1.6}
    .container{max-width:720px;margin:0 auto;padding:0 1.5rem}
    .hero{padding:6rem 0 3rem;text-align:center}
    .hero h1{font-size:clamp(2rem,5vw,3rem);font-weight:800;letter-spacing:-0.04em;line-height:1.1;margin-bottom:1rem}
    .hero h1 span{color:#4f46e5}
    .hero .sub{font-size:1.125rem;color:#525252;max-width:480px;margin:0 auto 2rem}
    .demo{max-width:560px;margin:0 auto 3rem;text-align:left}
    .demo-step{display:flex;gap:1rem;align-items:flex-start;margin-bottom:1.5rem}
    .demo-num{width:2rem;height:2rem;border-radius:50%;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0}
    .demo-text{flex:1}
    .demo-text strong{display:block;font-size:0.9375rem;margin-bottom:0.25rem}
    .demo-text span{font-size:0.8125rem;color:#737373}
    .features{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin:3rem 0}
    .feat{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:1.25rem}
    .feat h3{font-size:0.875rem;font-weight:600;margin-bottom:0.25rem}
    .feat p{font-size:0.8125rem;color:#737373}
    .types{text-align:center;margin:3rem 0}
    .types h2{font-size:1.25rem;font-weight:700;margin-bottom:1rem}
    .type-grid{display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:center}
    .type-chip{font-size:0.75rem;padding:0.25rem 0.75rem;border-radius:99px;border:1px solid #e5e5e5;color:#525252;background:#fff}
    footer{text-align:center;padding:3rem 0;color:#a3a3a3;font-size:0.75rem;border-top:1px solid #e5e5e5;margin-top:3rem}
  </style>
</head>
<body>
  <div class="container">
    <section class="hero">
      <h1>tiny<span>cloud</span></h1>
      <p class="sub">Upload any file. Get a beautiful, shareable URL. Built for AI agents.</p>
    </section>

    <div class="demo">
      <div class="demo-step">
        <div class="demo-num">1</div>
        <div class="demo-text"><strong>Agent creates a file</strong><span>CSV, Markdown, JSON, HTML, images — anything</span></div>
      </div>
      <div class="demo-step">
        <div class="demo-num">2</div>
        <div class="demo-text"><strong>One API call to tinycloud</strong><span>MCP tool, REST API, or CLI — zero config</span></div>
      </div>
      <div class="demo-step">
        <div class="demo-num">3</div>
        <div class="demo-text"><strong>Beautiful shareable URL</strong><span>CSV → interactive table. Markdown → styled page. JSON → collapsible tree.</span></div>
      </div>
    </div>

    <div class="types">
      <h2>Every file type, rendered beautifully</h2>
      <div class="type-grid">
        <span class="type-chip">CSV → Interactive Table</span>
        <span class="type-chip">Markdown → Styled Page</span>
        <span class="type-chip">JSON → Tree View</span>
        <span class="type-chip">Images → Gallery</span>
        <span class="type-chip">SVG → Zoomable Viewer</span>
        <span class="type-chip">PDF → Document Viewer</span>
        <span class="type-chip">Mermaid → Rendered Diagram</span>
        <span class="type-chip">HTML → Served As-Is</span>
      </div>
    </div>

    <div class="features">
      <div class="feat"><h3>MCP Native</h3><p>First-class agent integration. One tool call → live URL.</p></div>
      <div class="feat"><h3>Zero Config</h3><p>No accounts, no setup. Anonymous with 7-day TTL.</p></div>
      <div class="feat"><h3>Social Ready</h3><p>Rich OG previews on Slack, Twitter, iMessage.</p></div>
      <div class="feat"><h3>Edge Served</h3><p>Cloudflare global network. Fast everywhere.</p></div>
      <div class="feat"><h3>Smart Rendering</h3><p>Auto-detects file type and picks the best viewer.</p></div>
      <div class="feat"><h3>Open Source</h3><p>MIT licensed. Self-host, fork, contribute.</p></div>
    </div>
  </div>
  <footer>tinycloud — open source, MIT licensed</footer>
</body>
</html>`;
}

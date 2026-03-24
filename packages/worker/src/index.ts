import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import publishApi from "./api/publish";
import sitesApi from "./api/sites";
import { serveSite } from "./serve/handler";
import { docsPageHtml } from "./docs";

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

    // Local development — path-based routing (no subdomains on localhost)
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const apiPrefixes = ["/publish", "/finalize", "/sites", "/health"];
      if (apiPrefixes.some((p) => path === p || path.startsWith(p + "/"))) {
        return api.fetch(request, env, ctx);
      }

      // /docs — documentation page
      if (path === "/docs" || path === "/docs/") {
        return html(docsPageHtml(env.DOMAIN));
      }

      // /s/:slug — view a published site locally
      const siteMatch = path.match(/^\/s\/([a-z0-9][a-z0-9-]+[a-z0-9])(\/.*)?$/);
      if (siteMatch) {
        const localSlug = siteMatch[1];
        // Rewrite the URL so serveSite sees the correct sub-path
        const subPath = siteMatch[2] ?? "/";
        const rewritten = new Request(new URL(subPath, request.url), request);
        return serveSite(rewritten, env, localSlug);
      }

      return html(landingPageHtml(env.DOMAIN));
    }

    // API subdomain
    if (hostname === env.API_HOST) {
      return api.fetch(request, env, ctx);
    }

    // Root domain → landing page or docs
    if (hostname === env.DOMAIN || hostname === `www.${env.DOMAIN}`) {
      if (path === "/docs" || path === "/docs/") {
        return html(docsPageHtml(env.DOMAIN));
      }
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
  <title>tinycloud — Instant hosting for AI agents</title>
  <meta name="description" content="Upload any file, get a beautiful shareable URL. One API call turns CSV into sortable tables, Markdown into styled prose, JSON into interactive trees. Zero config.">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;line-height:1.6;-webkit-font-smoothing:antialiased}
    a{color:#60a5fa;text-decoration:none}
    a:hover{text-decoration:underline}
    .container{max-width:800px;margin:0 auto;padding:0 1.5rem}

    /* Nav */
    nav{position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(10,10,10,0.8);backdrop-filter:blur(12px);border-bottom:1px solid #1a1a1a}
    nav .inner{max-width:800px;margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;justify-content:space-between;height:56px}
    nav .logo{font-size:1.125rem;font-weight:700;letter-spacing:-0.03em;color:#fff}
    nav .logo span{color:#60a5fa}
    nav .links{display:flex;gap:1.5rem;align-items:center}
    nav .links a{font-size:0.8125rem;color:#a3a3a3;transition:color .15s}
    nav .links a:hover{color:#fff;text-decoration:none}

    /* Hero */
    .hero{padding:8rem 0 4rem;text-align:center}
    .hero h1{font-size:clamp(2.5rem,6vw,3.75rem);font-weight:800;letter-spacing:-0.04em;line-height:1.08;margin-bottom:1.25rem;color:#fff}
    .hero h1 .accent{color:#60a5fa}
    .hero .sub{font-size:1.125rem;color:#a3a3a3;max-width:520px;margin:0 auto 2.5rem;line-height:1.7}
    .hero .chips{display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:center;margin-bottom:2.5rem}
    .chip{font-size:0.75rem;padding:0.3rem 0.875rem;border-radius:99px;border:1px solid #262626;color:#a3a3a3;background:#141414;transition:all .2s}
    .chip:hover{border-color:#60a5fa;color:#60a5fa}

    /* Code block */
    .code-section{margin:0 auto 5rem;max-width:640px}
    .code-section h2{font-size:1rem;font-weight:600;color:#a3a3a3;text-align:center;margin-bottom:1.25rem;text-transform:uppercase;letter-spacing:0.08em;font-size:0.75rem}
    .terminal{background:#141414;border:1px solid #262626;border-radius:12px;overflow:hidden}
    .terminal-bar{display:flex;align-items:center;gap:6px;padding:12px 16px;background:#1a1a1a;border-bottom:1px solid #262626}
    .terminal-dot{width:10px;height:10px;border-radius:50%}
    .terminal-dot.r{background:#ff5f57}.terminal-dot.y{background:#ffbd2e}.terminal-dot.g{background:#28c840}
    .terminal-title{flex:1;text-align:center;font-size:0.6875rem;color:#525252}
    .terminal pre{padding:1.25rem 1.5rem;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.8125rem;line-height:1.8;overflow-x:auto;color:#a3a3a3}
    .terminal pre .comment{color:#525252}
    .terminal pre .key{color:#60a5fa}
    .terminal pre .str{color:#34d399}
    .terminal pre .url{color:#fbbf24}
    .terminal pre .arrow{color:#525252}

    /* Demos — before/after transformation */
    .demos{margin:0 auto 5rem}
    .demos h2{font-size:1.5rem;font-weight:700;color:#fff;text-align:center;margin-bottom:0.75rem}
    .demos .sub{text-align:center;color:#737373;margin-bottom:2rem;font-size:0.9375rem}
    .demo-list{display:flex;flex-direction:column;gap:1.5rem}
    .demo-row{display:grid;grid-template-columns:1fr auto 1fr;gap:0;align-items:stretch;background:#141414;border:1px solid #262626;border-radius:12px;overflow:hidden;transition:border-color .2s}
    .demo-row:hover{border-color:#333}
    .demo-raw,.demo-rendered{padding:1.25rem 1.5rem}
    .demo-raw{background:#0f0f0f;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.6875rem;line-height:1.6;color:#737373;white-space:pre;overflow:hidden}
    .demo-raw .label{display:block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:0.625rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#525252;margin-bottom:0.75rem}
    .demo-arrow{display:flex;align-items:center;justify-content:center;width:3rem;color:#525252;font-size:1.25rem;background:#141414;border-left:1px solid #262626;border-right:1px solid #262626;flex-shrink:0}
    .demo-rendered{font-size:0.75rem;line-height:1.5;overflow:hidden}
    .demo-rendered .label{display:block;font-size:0.625rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#60a5fa;margin-bottom:0.75rem}
    /* Mini markdown preview */
    .mini-md h3{font-size:0.8125rem;font-weight:700;color:#fff;margin-bottom:0.375rem}
    .mini-md p{color:#a3a3a3;font-size:0.6875rem;margin-bottom:0.25rem}
    .mini-md strong{color:#e5e5e5}
    .mini-md code{background:#262626;padding:0.1rem 0.3rem;border-radius:3px;font-size:0.625rem;color:#34d399}
    /* Mini table preview */
    .mini-table{width:100%;border-collapse:collapse;font-size:0.625rem}
    .mini-table th{text-align:left;color:#60a5fa;font-weight:600;padding:0.25rem 0.5rem;border-bottom:1px solid #262626}
    .mini-table td{color:#a3a3a3;padding:0.25rem 0.5rem;border-bottom:1px solid #1a1a1a}
    /* Mini JSON preview */
    .mini-json{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.625rem;line-height:1.6}
    .mini-json .jk{color:#60a5fa}
    .mini-json .js{color:#34d399}
    .mini-json .jn{color:#fbbf24}
    .mini-json .jb{color:#525252}
    @media(max-width:600px){
      .demo-row{grid-template-columns:1fr;grid-template-rows:auto auto auto}
      .demo-arrow{width:auto;height:2rem;border-left:0;border-right:0;border-top:1px solid #262626;border-bottom:1px solid #262626}
    }

    /* CTA */
    .cta{text-align:center;padding:4rem 0;border-top:1px solid #1a1a1a;margin-top:2rem}
    .cta h2{font-size:1.5rem;font-weight:700;color:#fff;margin-bottom:0.75rem}
    .cta p{color:#737373;margin-bottom:2rem;font-size:0.9375rem}
    .cta-buttons{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}
    .btn{padding:0.625rem 1.5rem;border-radius:8px;font-size:0.875rem;font-weight:600;transition:all .15s;display:inline-block}
    .btn-primary{background:#60a5fa;color:#0a0a0a}
    .btn-primary:hover{background:#93c5fd;text-decoration:none}
    .btn-secondary{background:transparent;color:#a3a3a3;border:1px solid #333}
    .btn-secondary:hover{color:#fff;border-color:#555;text-decoration:none}

    /* Footer */
    footer{text-align:center;padding:2.5rem 0;color:#525252;font-size:0.75rem;border-top:1px solid #1a1a1a}
    footer a{color:#525252}
    footer a:hover{color:#a3a3a3}

    /* Animations */
    @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .hero h1,.hero .sub,.hero .chips,.code-section,.demos,.cta{animation:fadeUp .6s ease both}
    .hero .sub{animation-delay:.1s}
    .hero .chips{animation-delay:.2s}
    .code-section{animation-delay:.3s}

    @media(max-width:600px){
      .hero{padding:6rem 0 3rem}
      .cta-buttons{flex-direction:column;align-items:center}
    }
  </style>
</head>
<body>
  <nav>
    <div class="inner">
      <div class="logo">tiny<span>cloud</span></div>
      <div class="links">
        <a href="#demos">Demos</a>
        <a href="/docs">Docs</a>
        <a href="https://github.com/nicepkg/tinycloud">GitHub</a>
      </div>
    </div>
  </nav>

  <div class="container">
    <section class="hero">
      <h1>Instant hosting for<br><span class="accent">AI agents</span></h1>
      <p class="sub">Upload a CSV, markdown doc, or diagram. tinycloud renders it beautifully and gives you a shareable URL.</p>
      <div class="chips">
        <span class="chip">CSV</span>
        <span class="chip">Markdown</span>
        <span class="chip">JSON</span>
        <span class="chip">HTML</span>
        <span class="chip">SVG</span>
        <span class="chip">PDF</span>
        <span class="chip">Mermaid</span>
        <span class="chip">Images</span>
      </div>
    </section>

    <section class="code-section">
      <h2>One call. Beautiful URL.</h2>
      <div class="terminal">
        <div class="terminal-bar">
          <div class="terminal-dot r"></div>
          <div class="terminal-dot y"></div>
          <div class="terminal-dot g"></div>
          <div class="terminal-title">publish_content</div>
        </div>
        <pre><span class="comment">// MCP tool — or just POST /publish/inline</span>
{
  <span class="key">"content"</span>: <span class="str">"# Hello World\\nSome **markdown** here."</span>,
  <span class="key">"contentType"</span>: <span class="str">"text/markdown"</span>
}

<span class="arrow">→</span> <span class="url">https://warm-dawn.${domain}</span></pre>
      </div>
    </section>

    <section class="demos" id="demos">
      <h2>See the transformation</h2>
      <p class="sub">Raw input on the left. What your users see on the right.</p>
      <div class="demo-list">

        <div class="demo-row">
          <div class="demo-raw"><span class="label">Markdown input</span># Q1 Results

Revenue grew **42%** YoY.

Key wins:
- Enterprise: \`+68%\`
- Self-serve: \`+31%\`</div>
          <div class="demo-arrow">&rarr;</div>
          <div class="demo-rendered"><span class="label">Rendered page</span><div class="mini-md"><h3>Q1 Results</h3><p>Revenue grew <strong>42%</strong> YoY.</p><p>Key wins:</p><p>&bull; Enterprise: <code>+68%</code></p><p>&bull; Self-serve: <code>+31%</code></p></div></div>
        </div>

        <div class="demo-row">
          <div class="demo-raw"><span class="label">CSV input</span>name,role,team,joined
Alice,Engineer,Platform,2024
Bob,Designer,Product,2023
Carol,PM,Growth,2025
Dave,Engineer,Infra,2024</div>
          <div class="demo-arrow">&rarr;</div>
          <div class="demo-rendered"><span class="label">Sortable table</span><table class="mini-table"><tr><th>name</th><th>role</th><th>team</th><th>joined</th></tr><tr><td>Alice</td><td>Engineer</td><td>Platform</td><td>2024</td></tr><tr><td>Bob</td><td>Designer</td><td>Product</td><td>2023</td></tr><tr><td>Carol</td><td>PM</td><td>Growth</td><td>2025</td></tr><tr><td>Dave</td><td>Engineer</td><td>Infra</td><td>2024</td></tr></table></div>
        </div>

        <div class="demo-row">
          <div class="demo-raw"><span class="label">JSON input</span>{
  "user": {
    "name": "Alice",
    "plan": "pro",
    "usage": 8420,
    "active": true
  }
}</div>
          <div class="demo-arrow">&rarr;</div>
          <div class="demo-rendered"><span class="label">Interactive tree</span><div class="mini-json"><span class="jb">{</span><br>&nbsp;&nbsp;<span class="jk">"user"</span>: <span class="jb">{</span><br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="jk">"name"</span>: <span class="js">"Alice"</span><br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="jk">"plan"</span>: <span class="js">"pro"</span><br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="jk">"usage"</span>: <span class="jn">8420</span><br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="jk">"active"</span>: <span class="jn">true</span><br>&nbsp;&nbsp;<span class="jb">}</span><br><span class="jb">}</span></div></div>
        </div>

      </div>
    </section>

    <section class="cta">
      <h2>Try it now</h2>
      <p>Publish your first file in under 10 seconds.</p>
      <div class="cta-buttons">
        <a class="btn btn-primary" href="/docs">API Docs</a>
        <a class="btn btn-secondary" href="https://github.com/nicepkg/tinycloud">View on GitHub</a>
      </div>
    </section>
  </div>

  <footer>
    <div class="container">tinycloud &mdash; open source, MIT licensed</div>
  </footer>
</body>
</html>`;
}

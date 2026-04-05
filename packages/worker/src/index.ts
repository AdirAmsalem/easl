import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import publishApi from "./api/publish";
import sitesApi from "./api/sites";
import feedbackApi from "./api/feedback";
import { serveSite } from "./serve/handler";
import { docsPageHtml } from "./docs";

// ─────────────────────────────────────────────
// easl — Beautiful auto-rendering for agent output
// ─────────────────────────────────────────────

const api = new Hono<{ Bindings: Env }>();

api.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Claim-Token"],
  maxAge: 86400,
}));

api.get("/", (c) => c.json({
  name: "easl",
  version: "0.1.0",
  description: "Agent-native hosting with beautiful auto-rendering",
  docs: `https://${c.env.DOMAIN}/docs`,
  status: "operational",
}));

api.get("/health", (c) => c.json({ ok: true }));

api.route("/", publishApi);
api.route("/", sitesApi);
api.route("/", feedbackApi);

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

    const req = classifyRequest(hostname, path, env);
    console.log(JSON.stringify({ event: "request", method: request.method, path, route: req.route, slug: req.slug, ua: request.headers.get("user-agent") }));

    // API subdomain
    if (hostname === env.API_HOST) {
      return api.fetch(request, env, ctx);
    }

    // Root domain → landing page, docs, or path-based API routing
    if (hostname === env.DOMAIN || hostname === `www.${env.DOMAIN}`) {
      return pathBasedRouting(request, env, ctx, url, html);
    }

    // Wildcard subdomain → serve site with smart rendering
    const domainSuffix = `.${env.DOMAIN}`;
    if (hostname.endsWith(domainSuffix)) {
      const subdomain = hostname.slice(0, -domainSuffix.length);

      // Deploy preview proxy: preview-pr-N.easl.dev → easl-preview-N.workers.dev
      const previewMatch = subdomain.match(/^preview-pr-(\d+)$/);
      if (previewMatch) {
        const workerHost = `easl-preview-${previewMatch[1]}.${env.WORKERS_DEV_SUBDOMAIN}.workers.dev`;
        const proxyUrl = new URL(request.url);
        proxyUrl.hostname = workerHost;
        proxyUrl.port = "";
        return fetch(new Request(proxyUrl.toString(), request));
      }

      if (subdomain && !subdomain.includes(".")) {
        return serveSite(request, env, subdomain, ctx);
      }
    }

    // Path-based routing fallback (localhost, workers.dev previews, etc.)
    return pathBasedRouting(request, env, ctx, url, html);
  },
};

// ─────────────────────────────────────────────
// Path-based routing (localhost, workers.dev previews)
// ─────────────────────────────────────────────

async function pathBasedRouting(
  request: Request, env: Env, ctx: ExecutionContext,
  url: URL, html: (body: string) => Response,
): Promise<Response> {
  const path = url.pathname;

  const apiPrefixes = ["/publish", "/finalize", "/sites", "/health", "/feedback"];
  if (apiPrefixes.some((p) => path === p || path.startsWith(p + "/"))) {
    return api.fetch(request, env, ctx);
  }

  if (path === "/docs" || path === "/docs/") {
    return html(docsPageHtml(env.DOMAIN));
  }

  // /s/:slug — view a published site
  const siteMatch = path.match(/^\/s\/([a-z0-9][a-z0-9-]+[a-z0-9])(\/.*)?$/);
  if (siteMatch) {
    const slug = siteMatch[1];
    const subPath = siteMatch[2] ?? "/";
    const rewritten = new Request(new URL(subPath, request.url), request);
    return serveSite(rewritten, env, slug, ctx, `/s/${slug}`);
  }

  return html(landingPageHtml(env.DOMAIN));
}

function classifyRequest(hostname: string, path: string, workerEnv: Env): { route: string; slug?: string } {
  if (hostname === workerEnv.API_HOST) return { route: "api" };

  const domainSuffix = `.${workerEnv.DOMAIN}`;
  if (hostname.endsWith(domainSuffix)) {
    return { route: "site", slug: hostname.slice(0, -domainSuffix.length) };
  }

  const siteMatch = path.match(/^\/s\/([a-z0-9][a-z0-9-]+[a-z0-9])/);
  if (siteMatch) return { route: "site", slug: siteMatch[1] };

  if (path.startsWith("/publish") || path.startsWith("/finalize") || path.startsWith("/sites") || path.startsWith("/feedback")) return { route: "api" };
  if (path === "/docs" || path === "/docs/") return { route: "docs" };

  return { route: "landing" };
}

// ─────────────────────────────────────────────
// Landing page
// ─────────────────────────────────────────────

function landingPageHtml(domain: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>easl — Instant hosting for AI agents</title>
  <meta name="description" content="Turn agent output into pages worth sharing. One API call turns CSV into sortable tables, Markdown into styled prose, JSON into interactive trees. Zero config.">
  <meta property="og:type" content="website">
  <meta property="og:title" content="easl — Instant hosting for AI agents">
  <meta property="og:description" content="Turn agent output into pages worth sharing. CSV into sortable tables, Markdown into styled prose, JSON into interactive trees.">
  <meta property="og:image" content="https://${domain}/og.png">
  <meta property="og:url" content="https://${domain}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="easl — Instant hosting for AI agents">
  <meta name="twitter:description" content="Turn agent output into pages worth sharing.">
  <meta name="twitter:image" content="https://${domain}/og.png">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <script>(function(){var t=localStorage.getItem('easl-theme')||(matchMedia('(prefers-color-scheme:light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t)})()</script>
  <style>
    :root{--bg:#050505;--bg-elevated:#141414;--bg-subtle:#0f0f0f;--surface:rgba(255,255,255,0.02);--surface-hover:rgba(255,255,255,0.06);--border:#141414;--border-subtle:#1a1a1a;--border-medium:#262626;--border-hover:#333;--text:#e5e5e5;--text-heading:#fff;--text-muted:#a3a3a3;--text-faint:#737373;--text-faintest:#525252;--text-dim:#555;--accent:#60a5fa;--accent-hover:#93c5fd;--green:#34d399;--yellow:#fbbf24;--nav-bg:rgba(5,5,5,0.85);--demo-bg:rgba(12,12,12,0.9);--demo-glow-1:rgba(255,255,255,0.1);--demo-glow-2:rgba(255,255,255,0.05);--demo-tab-bg:rgba(255,255,255,0.03);--demo-tab-border:rgba(255,255,255,0.05);--demo-prompt-border:rgba(255,255,255,0.04);--avatar-bg:rgba(255,255,255,0.06);--avatar-accent-bg:rgba(96,165,250,0.12);--url-bg:rgba(52,211,153,0.1);--preview-bg:rgba(0,0,0,0.35);--preview-border:rgba(255,255,255,0.04);--code-bg:#262626;--btn-primary-text:#0a0a0a;--logo-color:#fff}
    [data-theme="light"]{--bg:#fafafa;--bg-elevated:#fff;--bg-subtle:#f5f5f5;--surface:rgba(0,0,0,0.02);--surface-hover:rgba(0,0,0,0.06);--border:#e5e5e5;--border-subtle:#ebebeb;--border-medium:#d4d4d4;--border-hover:#bbb;--text:#1a1a1a;--text-heading:#000;--text-muted:#525252;--text-faint:#737373;--text-faintest:#a3a3a3;--text-dim:#888;--accent:#2563eb;--accent-hover:#1d4ed8;--green:#059669;--yellow:#d97706;--nav-bg:rgba(250,250,250,0.85);--demo-bg:rgba(255,255,255,0.95);--demo-glow-1:rgba(0,0,0,0.06);--demo-glow-2:rgba(0,0,0,0.03);--demo-tab-bg:rgba(0,0,0,0.02);--demo-tab-border:rgba(0,0,0,0.06);--demo-prompt-border:rgba(0,0,0,0.06);--avatar-bg:rgba(0,0,0,0.05);--avatar-accent-bg:rgba(37,99,235,0.1);--url-bg:rgba(5,150,105,0.08);--preview-bg:rgba(0,0,0,0.03);--preview-border:rgba(0,0,0,0.06);--code-bg:#e5e5e5;--btn-primary-text:#fff;--logo-color:#000}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased;transition:background .2s,color .2s}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    .container{max-width:800px;margin:0 auto;padding:0 1.5rem}

    /* Nav */
    nav{position:fixed;top:0;left:0;right:0;z-index:50;background:var(--nav-bg);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
    nav .inner{max-width:800px;margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;justify-content:space-between;height:56px}
    nav .logo{display:flex;align-items:center}
    nav .logo img{display:block;color:var(--logo-color)}
    nav .links{display:flex;gap:1.5rem;align-items:center}
    nav .links a{font-size:0.8125rem;color:var(--text-muted);transition:color .15s}
    nav .links a:hover{color:var(--text-heading);text-decoration:none}
    .theme-toggle{background:none;border:1px solid var(--border-medium);border-radius:6px;padding:0.3rem 0.5rem;cursor:pointer;color:var(--text-muted);font-size:0.875rem;line-height:1;transition:all .15s}
    .theme-toggle:hover{border-color:var(--border-hover);color:var(--text-heading)}

    .hero-wrap{position:relative}

    /* Hero — title flows into demo as one unit */
    .hero{padding:7.5rem 0 1.5rem;text-align:center;position:relative}
    .hero h1{font-size:clamp(2.5rem,6vw,3.75rem);font-weight:800;letter-spacing:-0.04em;line-height:1.08;margin-bottom:1rem;color:var(--text-heading)}
    .hero h1 .accent{color:var(--accent)}
    .hero .sub{font-size:1.0625rem;color:var(--text-faint);max-width:520px;margin:0 auto 0;line-height:1.7}

    /* Hero terminal — animated demo */
    .hero-terminal{margin:2.5rem auto 0;max-width:640px;position:relative;text-align:left}
    .hero-terminal::before{content:'';position:absolute;inset:-1px;border-radius:15px;padding:1px;background:linear-gradient(170deg,var(--demo-glow-1) 0%,transparent 40%,var(--demo-glow-2) 80%,transparent);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;z-index:1}
    .term-chrome{position:relative;z-index:1;background:var(--demo-bg);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:14px;overflow:hidden}
    .term-header{display:flex;align-items:center;gap:0.5rem;padding:0.75rem 1rem;border-bottom:1px solid var(--demo-tab-border)}
    .term-dots{display:flex;gap:6px}
    .term-dot{width:10px;height:10px;border-radius:50%}
    .term-dot.r{background:#ff5f57;opacity:0.7}
    .term-dot.y{background:#febc2e;opacity:0.7}
    .term-dot.g{background:#28c840;opacity:0.7}
    .term-indicators{display:flex;gap:6px;margin-left:auto}
    .term-indicator{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.5625rem;padding:2px 8px;border-radius:9px;background:var(--surface);color:var(--text-faintest);cursor:pointer;transition:all .2s;border:1px solid transparent;line-height:1.4}
    .term-indicator:hover{color:var(--text-muted);border-color:var(--border-medium)}
    .term-indicator.active{color:var(--accent);background:var(--avatar-accent-bg);border-color:rgba(96,165,250,0.25)}
    .term-body{padding:1.25rem 1.5rem;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.8125rem;line-height:1.7;min-height:340px;transition:opacity .3s ease}
    .term-line{opacity:0;transform:translateY(3px);transition:opacity .25s ease,transform .25s ease;white-space:pre-wrap;word-break:break-all}
    .term-line.visible{opacity:1;transform:none}
    .term-line.typing{opacity:1;transform:none}
    .term-prompt{color:var(--green)}
    .term-cmd{color:var(--text-heading)}
    .term-dim{color:var(--text-faintest)}
    .term-accent{color:var(--accent)}
    .term-ok{color:var(--green);font-weight:600}
    .term-url{display:inline;background:var(--url-bg);color:var(--green);padding:0.125rem 0.5rem;border-radius:3px}
    .term-box{color:var(--text-faint);font-size:0.75rem;line-height:1.5}
    @keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}
    .term-cursor{display:inline-block;width:0.5em;height:1.1em;background:var(--text-heading);vertical-align:text-bottom;animation:blink 1s step-end infinite;margin-left:1px}

    /* Setup section */
    .setup{margin:4rem auto 5rem;max-width:640px}
    .setup-header{text-align:center;margin-bottom:1.5rem}
    .setup-header h2{font-size:1.25rem;font-weight:700;color:var(--text-heading);margin-bottom:0.375rem}
    .setup-header p{font-size:0.875rem;color:var(--text-faintest)}
    .setup-row{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}
    .setup-card{background:var(--surface);border:1px solid var(--surface-hover);border-radius:10px;padding:1.125rem 1.25rem;transition:border-color .2s}
    .setup-card:hover{border-color:var(--border-hover)}
    .setup-card .label{font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:0.25rem}
    .setup-card .desc{font-size:0.6875rem;color:var(--text-dim);margin-bottom:0.75rem}
    .setup-card pre{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.6875rem;line-height:1.6;color:var(--text-faint);white-space:pre;overflow-x:auto}
    .setup-card pre .k{color:var(--accent)}
    .setup-card pre .s{color:var(--green)}
    .setup-card pre .c{color:var(--text-dim)}
    .setup-card pre .u{color:var(--yellow)}
    .setup-compat{text-align:center;font-size:0.75rem;color:var(--text-faintest);margin-top:1.25rem}
    @media(max-width:600px){.setup-row{grid-template-columns:1fr}}

    /* Demos — before/after transformation */
    .demos{margin:0 auto 5rem;scroll-margin-top:4rem}
    .demos h2{font-size:1.5rem;font-weight:700;color:var(--text-heading);text-align:center;margin-bottom:0.75rem}
    .demos .sub{text-align:center;color:var(--text-faint);margin-bottom:2rem;font-size:0.9375rem}
    .demo-list{display:flex;flex-direction:column;gap:1.5rem}
    .demo-row{display:grid;grid-template-columns:1fr auto 1fr;gap:0;align-items:stretch;background:var(--bg-elevated);border:1px solid var(--border-medium);border-radius:12px;overflow:hidden;transition:border-color .2s}
    .demo-row:hover{border-color:var(--border-hover)}
    .demo-raw,.demo-rendered{padding:1.25rem 1.5rem}
    .demo-raw{background:var(--bg-subtle);font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.6875rem;line-height:1.6;color:var(--text-faint);white-space:pre;overflow:hidden}
    .demo-raw .label{display:block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:0.625rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-faintest);margin-bottom:0.75rem}
    .demo-arrow{display:flex;align-items:center;justify-content:center;width:3rem;color:var(--text-faintest);font-size:1.25rem;background:var(--bg-elevated);border-left:1px solid var(--border-medium);border-right:1px solid var(--border-medium);flex-shrink:0}
    .demo-rendered{font-size:0.75rem;line-height:1.5;overflow:hidden}
    .demo-rendered .label{display:block;font-size:0.625rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent);margin-bottom:0.75rem}
    /* Mini markdown preview */
    .mini-md h3{font-size:0.8125rem;font-weight:700;color:var(--text-heading);margin-bottom:0.375rem}
    .mini-md p{color:var(--text-muted);font-size:0.6875rem;margin-bottom:0.25rem}
    .mini-md strong{color:var(--text)}
    .mini-md code{background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.625rem;color:var(--green)}
    /* Mini table preview */
    .mini-table{width:100%;border-collapse:collapse;font-size:0.625rem}
    .mini-table th{text-align:left;color:var(--accent);font-weight:600;padding:0.25rem 0.5rem;border-bottom:1px solid var(--border-medium)}
    .mini-table td{color:var(--text-muted);padding:0.25rem 0.5rem;border-bottom:1px solid var(--border-subtle)}
    /* Mini JSON preview */
    .mini-json{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.625rem;line-height:1.6}
    .mini-json .jk{color:var(--accent)}
    .mini-json .js{color:var(--green)}
    .mini-json .jn{color:var(--yellow)}
    .mini-json .jb{color:var(--text-faintest)}
    @media(max-width:600px){
      .demo-row{grid-template-columns:1fr;grid-template-rows:auto auto auto}
      .demo-arrow{width:auto;height:2rem;border-left:0;border-right:0;border-top:1px solid var(--border-medium);border-bottom:1px solid var(--border-medium)}
    }

    /* CTA */
    .cta{text-align:center;padding:4rem 0;border-top:1px solid var(--border-subtle);margin-top:2rem}
    .cta h2{font-size:1.5rem;font-weight:700;color:var(--text-heading);margin-bottom:0.75rem}
    .cta p{color:var(--text-faint);margin-bottom:0.5rem;font-size:0.9375rem}
    .cta .cta-sub{font-size:0.8125rem;color:var(--text-faintest);margin-bottom:2rem}
    .cta-buttons{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}
    .btn{padding:0.625rem 1.5rem;border-radius:8px;font-size:0.875rem;font-weight:600;transition:all .15s;display:inline-block}
    .btn-primary{background:var(--accent);color:var(--btn-primary-text)}
    .btn-primary:hover{background:var(--accent-hover);text-decoration:none}
    .btn-secondary{background:transparent;color:var(--text-muted);border:1px solid var(--border-hover)}
    .btn-secondary:hover{color:var(--text-heading);border-color:var(--text-faintest);text-decoration:none}

    /* Footer */
    footer{text-align:center;padding:2.5rem 0;color:var(--text-faintest);font-size:0.75rem;border-top:1px solid var(--border-subtle)}
    footer a{color:var(--text-faintest)}
    footer a:hover{color:var(--text-muted)}

    /* Animations */
    @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .hero h1,.hero .sub,.hero-terminal,.setup,.demos,.cta{animation:fadeUp .5s ease both}
    .hero .sub{animation-delay:.08s}
    .hero-terminal{animation-delay:.18s}
    .setup{animation-delay:.25s}

    @media(max-width:600px){
      .hero{padding:6rem 0 3rem}
      .cta-buttons{flex-direction:column;align-items:stretch;max-width:13rem;margin-left:auto;margin-right:auto}
      .cta-buttons .btn{text-align:center}
    }
  </style>
</head>
<body>
  <nav>
    <div class="inner">
      <a href="/" class="logo"><img src="/logo.svg" alt="easl" height="24" class="nav-logo"></a>
      <div class="links">
        <a href="#demos">Demos</a>
        <a href="/docs">Docs</a>
        <a href="https://github.com/AdirAmsalem/easl">GitHub</a>
        <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle theme" id="theme-btn"></button>
      </div>
    </div>
  </nav>

  <div class="hero-wrap">
  <div class="container">
    <section class="hero">
      <h1>Instant hosting for<br><span class="accent">AI agents</span></h1>
      <p class="sub">Your agent sends content. easl turns it into a page worth sharing.</p>

      <div class="hero-terminal">
        <div class="term-chrome">
          <div class="term-header">
            <div class="term-dots"><div class="term-dot r"></div><div class="term-dot y"></div><div class="term-dot g"></div></div>
            <div class="term-indicators" id="term-indicators"></div>
          </div>
          <div class="term-body" id="term"></div>
        </div>
      </div>
    </section>

    <section class="setup">
      <div class="setup-header">
        <h2>Start in seconds</h2>
        <p>No signup. No auth. Just publish.</p>
      </div>
      <div class="setup-row">
        <div class="setup-card">
          <div class="label">Use easl MCP</div>
          <div class="desc">Works with Claude Code, Codex, Cursor &amp; more</div>
          <pre>{
  <span class="k">"mcpServers"</span>: {
    <span class="s">"easl"</span>: {
      <span class="k">"command"</span>: <span class="s">"npx"</span>,
      <span class="k">"args"</span>: [<span class="s">"-y"</span>, <span class="s">"@easl/mcp"</span>]
    }
  }
}</pre>
        </div>
        <div class="setup-card">
          <div class="label">Or call the API directly</div>
          <div class="desc">One curl command, instant shareable URL</div>
          <pre><span class="k">curl</span> api.${domain}/publish/inline \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"content":"name,role\\nAlice,Eng",
  "contentType":"text/csv"}'</span>

<span class="c">#</span> <span class="u">https://warm-dawn.${domain}</span></pre>
        </div>
      </div>
      <p class="setup-compat">Works with Claude Code, Codex, Cursor, ChatGPT, OpenClaw &amp; any AI agent.</p>
    </section>
  </div>

  <div class="container">
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
      <p class="cta-sub">Free and open-source. Self-host or use our hosted version.</p>
      <div class="cta-buttons">
        <a class="btn btn-primary" href="/docs">Get Started</a>
        <a class="btn btn-secondary" href="https://github.com/AdirAmsalem/easl">View on GitHub</a>
      </div>
    </section>
  </div>

  <footer>
    <div class="container">easl &mdash; open source, MIT licensed</div>
  </footer>
  <script>
    function getTheme(){return localStorage.getItem('easl-theme')||(matchMedia('(prefers-color-scheme:light)').matches?'light':'dark')}
    function applyTheme(t){document.documentElement.setAttribute('data-theme',t);document.getElementById('theme-btn').textContent=t==='dark'?'\\u263E':'\\u2600';document.querySelectorAll('.nav-logo').forEach(function(img){img.src=t==='dark'?'/logo.svg':'/logo-light.svg'})}
    function toggleTheme(){var t=getTheme()==='dark'?'light':'dark';localStorage.setItem('easl-theme',t);applyTheme(t)}
    applyTheme(getTheme());
  </script>
  <script>
    (function(){
      var term=document.getElementById('term');
      var indicatorsEl=document.getElementById('term-indicators');
      if(!term||!indicatorsEl)return;

      var scripts=[
        {label:'CSV',lines:[
          {text:'<span class="term-prompt">$</span> <span class="term-cmd">Analyze the team roster and share it</span>',delay:300,type:'type'},
          {text:'',delay:600,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Reading team_roster.csv...</span>',delay:400,type:'instant'},
          {text:'<span class="term-dim">  Parsed 12 rows \\u00d7 4 columns</span>',delay:800,type:'instant'},
          {text:'<span class="term-dim">  Departments: Eng, Design, Product, Growth</span>',delay:600,type:'instant'},
          {text:'<span class="term-dim">  Adding sortable headers and filters</span>',delay:700,type:'instant'},
          {text:'',delay:500,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Publishing to easl...</span>',delay:200,type:'instant'},
          {text:'',delay:1200,type:'instant'},
          {text:'<span class="term-ok">\\u2713 Published:</span> <span class="term-url">https://warm-dawn.${domain}</span>',delay:200,type:'instant'}
        ]},
        {label:'Markdown',lines:[
          {text:'<span class="term-prompt">$</span> <span class="term-cmd">Write up the Q1 results and share them</span>',delay:300,type:'type'},
          {text:'',delay:600,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Drafting Q1 summary...</span>',delay:400,type:'instant'},
          {text:'<span class="term-dim">  Revenue: $2.4M (+42% YoY)</span>',delay:700,type:'instant'},
          {text:'<span class="term-dim">  Adding sections: key wins, regional breakdown</span>',delay:600,type:'instant'},
          {text:'<span class="term-dim">  Formatting tables and highlights</span>',delay:700,type:'instant'},
          {text:'',delay:500,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Publishing to easl...</span>',delay:200,type:'instant'},
          {text:'',delay:1200,type:'instant'},
          {text:'<span class="term-ok">\\u2713 Published:</span> <span class="term-url">https://blue-river.${domain}</span>',delay:200,type:'instant'}
        ]},
        {label:'HTML',lines:[
          {text:'<span class="term-prompt">$</span> <span class="term-cmd">Build a metrics dashboard and publish it</span>',delay:300,type:'type'},
          {text:'',delay:600,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Building dashboard layout...</span>',delay:400,type:'instant'},
          {text:'<span class="term-dim">  Scaffolding responsive grid</span>',delay:700,type:'instant'},
          {text:'<span class="term-dim">  Rendering 3 charts + KPI cards</span>',delay:800,type:'instant'},
          {text:'<span class="term-dim">  Bundling CSS and inline assets</span>',delay:600,type:'instant'},
          {text:'',delay:500,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Publishing to easl...</span>',delay:200,type:'instant'},
          {text:'',delay:1200,type:'instant'},
          {text:'<span class="term-ok">\\u2713 Published:</span> <span class="term-url">https://swift-peak.${domain}</span>',delay:200,type:'instant'}
        ]},
        {label:'JSON',lines:[
          {text:'<span class="term-prompt">$</span> <span class="term-cmd">Share the API response from /users/alice</span>',delay:300,type:'type'},
          {text:'',delay:600,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Fetching /users/alice...</span>',delay:400,type:'instant'},
          {text:'<span class="term-dim">  200 OK \\u00b7 1.2 KB response</span>',delay:600,type:'instant'},
          {text:'<span class="term-dim">  4 top-level keys, 2 nested objects</span>',delay:600,type:'instant'},
          {text:'<span class="term-dim">  Building collapsible tree view</span>',delay:700,type:'instant'},
          {text:'',delay:500,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Publishing to easl...</span>',delay:200,type:'instant'},
          {text:'',delay:1200,type:'instant'},
          {text:'<span class="term-ok">\\u2713 Published:</span> <span class="term-url">https://cool-leaf.${domain}</span>',delay:200,type:'instant'}
        ]},
        {label:'SVG',lines:[
          {text:'<span class="term-prompt">$</span> <span class="term-cmd">Create a diagram of our auth flow and share it</span>',delay:300,type:'type'},
          {text:'',delay:600,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Generating SVG diagram...</span>',delay:400,type:'instant'},
          {text:'<span class="term-dim">  Mapping OAuth flow: 6 steps, 3 actors</span>',delay:700,type:'instant'},
          {text:'<span class="term-dim">  Laying out nodes and connections</span>',delay:700,type:'instant'},
          {text:'<span class="term-dim">  Rendering vector paths</span>',delay:600,type:'instant'},
          {text:'',delay:500,type:'instant'},
          {text:'<span class="term-dim">\\u25cf Publishing to easl...</span>',delay:200,type:'instant'},
          {text:'',delay:1200,type:'instant'},
          {text:'<span class="term-ok">\\u2713 Published:</span> <span class="term-url">https://red-cloud.${domain}</span>',delay:200,type:'instant'}
        ]}
      ];

      var currentIdx=0;
      var running=false;
      var autoTimer=null;
      var runId=0;
      var cursor=document.createElement('span');
      cursor.className='term-cursor';

      scripts.forEach(function(s,i){
        var pill=document.createElement('button');
        pill.className='term-indicator'+(i===0?' active':'');
        pill.textContent=s.label;
        pill.onclick=function(){switchTo(i)};
        indicatorsEl.appendChild(pill);
      });

      function updateIndicators(idx){
        indicatorsEl.querySelectorAll('.term-indicator').forEach(function(p,i){
          p.classList.toggle('active',i===idx);
        });
      }

      function addLine(html){
        var div=document.createElement('div');
        div.className='term-line';
        div.innerHTML=html;
        term.appendChild(div);
        return div;
      }

      function showLine(div){div.classList.add('visible')}

      function typeText(div,html,cb){
        div.classList.add('typing');
        var tmp=document.createElement('span');
        tmp.innerHTML=html;
        var plain=tmp.textContent||'';
        var i=0;
        div.textContent='';
        div.appendChild(cursor);
        function tick(){
          if(i<plain.length){
            div.insertBefore(document.createTextNode(plain[i]),cursor);
            i++;
            setTimeout(tick,30+Math.random()*25);
          }else{
            if(cursor.parentNode)cursor.parentNode.removeChild(cursor);
            div.innerHTML=html;
            cb();
          }
        }
        tick();
      }

      function runScript(idx,cb){
        var id=++runId;
        running=true;
        var lines=scripts[idx].lines;
        var t=0;
        var done=0;
        lines.forEach(function(s,i){
          t+=s.delay;
          var ms=t;
          setTimeout(function(){
            if(id!==runId)return;
            if(s.type==='type'){
              var div=addLine('');
              typeText(div,s.text,function(){
                done++;
                if(done>=lines.length){running=false;cb&&cb()}
              });
            }else{
              var div=addLine(s.text);
              showLine(div);
              done++;
              if(done>=lines.length){running=false;cb&&cb()}
            }
          },ms);
          if(s.type==='type'){
            t+=(s.text.replace(/<[^>]*>/g,'').length)*42;
          }
        });
      }

      function switchTo(idx){
        clearTimeout(autoTimer);
        runId++;
        currentIdx=idx;
        updateIndicators(idx);
        term.style.opacity='0';
        setTimeout(function(){
          term.innerHTML='';
          term.style.opacity='1';
          runScript(idx,function(){
            appendCursor();
            scheduleNext();
          });
        },350);
      }

      function scheduleNext(){
        autoTimer=setTimeout(function(){
          switchTo((currentIdx+1)%scripts.length);
        },5000);
      }

      function appendCursor(){
        var lines=term.querySelectorAll('.term-line');
        if(lines.length){lines[lines.length-1].appendChild(cursor)}
      }

      function start(){
        runScript(0,function(){
          appendCursor();
          scheduleNext();
        });
      }

      if('IntersectionObserver' in window){
        var started=false;
        var obs=new IntersectionObserver(function(entries){
          if(entries[0].isIntersecting&&!started){
            started=true;
            obs.disconnect();
            start();
          }
        },{threshold:0.3});
        obs.observe(term);
      }else{
        start();
      }
    })();
  </script>
</body>
</html>`;
}

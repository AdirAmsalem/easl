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

    /* Renderers */
    .renderers{margin:0 auto 5rem}
    .renderers h2{font-size:1.5rem;font-weight:700;color:#fff;text-align:center;margin-bottom:0.75rem}
    .renderers .sub{text-align:center;color:#737373;margin-bottom:2rem;font-size:0.9375rem}
    .render-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem}
    .render-card{background:#141414;border:1px solid #262626;border-radius:10px;padding:1.25rem;text-align:center;transition:all .2s}
    .render-card:hover{border-color:#333;transform:translateY(-2px)}
    .render-card .icon{font-size:1.5rem;margin-bottom:0.5rem}
    .render-card .from{font-size:0.8125rem;font-weight:600;color:#e5e5e5;margin-bottom:0.25rem}
    .render-card .to{font-size:0.6875rem;color:#737373}

    /* Demos */
    .demos{margin:0 auto 5rem}
    .demos h2{font-size:1.5rem;font-weight:700;color:#fff;text-align:center;margin-bottom:0.75rem}
    .demos .sub{text-align:center;color:#737373;margin-bottom:2rem;font-size:0.9375rem}
    .demo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
    .demo-card{background:#141414;border:1px solid #262626;border-radius:10px;overflow:hidden;transition:all .2s;text-decoration:none!important}
    .demo-card:hover{border-color:#60a5fa;transform:translateY(-2px)}
    .demo-card .demo-preview{height:120px;background:#111;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #262626;font-size:2rem;color:#525252}
    .demo-card .demo-info{padding:1rem}
    .demo-card .demo-type{font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#60a5fa;margin-bottom:0.25rem}
    .demo-card .demo-title{font-size:0.875rem;font-weight:600;color:#e5e5e5;margin-bottom:0.25rem}
    .demo-card .demo-desc{font-size:0.75rem;color:#737373}

    /* Features */
    .features{margin:0 auto 5rem}
    .features h2{font-size:1.5rem;font-weight:700;color:#fff;text-align:center;margin-bottom:2rem}
    .feat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
    .feat{background:#141414;border:1px solid #262626;border-radius:10px;padding:1.5rem;transition:border-color .2s}
    .feat:hover{border-color:#333}
    .feat h3{font-size:0.9375rem;font-weight:600;color:#fff;margin-bottom:0.375rem}
    .feat p{font-size:0.8125rem;color:#737373;line-height:1.5}

    /* How it works */
    .how{margin:0 auto 5rem}
    .how h2{font-size:1.5rem;font-weight:700;color:#fff;text-align:center;margin-bottom:2rem}
    .steps{display:flex;flex-direction:column;gap:1.5rem;max-width:480px;margin:0 auto}
    .step{display:flex;gap:1rem;align-items:flex-start}
    .step-num{width:2rem;height:2rem;border-radius:50%;background:#1e3a5f;color:#60a5fa;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0}
    .step-text{flex:1}
    .step-text strong{display:block;font-size:0.9375rem;color:#e5e5e5;margin-bottom:0.125rem}
    .step-text span{font-size:0.8125rem;color:#737373}

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
    .hero h1,.hero .sub,.hero .chips,.code-section,.renderers,.features,.how,.cta{animation:fadeUp .6s ease both}
    .hero .sub{animation-delay:.1s}
    .hero .chips{animation-delay:.2s}
    .code-section{animation-delay:.3s}

    @media(max-width:600px){
      .hero{padding:6rem 0 3rem}
      .render-grid{grid-template-columns:repeat(2,1fr)}
      .feat-grid{grid-template-columns:1fr}
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
      <p class="sub">Your agent creates a CSV, a report, a diagram. tinycloud turns it into a beautiful page you can share with anyone.</p>
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

    <section class="renderers">
      <h2>Every file type, rendered beautifully</h2>
      <p class="sub">Auto-detected. No configuration needed.</p>
      <div class="render-grid">
        <div class="render-card"><div class="icon">&#x1F4CA;</div><div class="from">CSV</div><div class="to">Sortable, filterable table</div></div>
        <div class="render-card"><div class="icon">&#x1F4DD;</div><div class="from">Markdown</div><div class="to">Styled prose with syntax highlighting</div></div>
        <div class="render-card"><div class="icon">&#x1F333;</div><div class="from">JSON</div><div class="to">Collapsible tree viewer</div></div>
        <div class="render-card"><div class="icon">&#x1F310;</div><div class="from">HTML</div><div class="to">Served exactly as-is</div></div>
        <div class="render-card"><div class="icon">&#x1F5BC;</div><div class="from">Images</div><div class="to">Responsive gallery</div></div>
        <div class="render-card"><div class="icon">&#x2B50;</div><div class="from">SVG</div><div class="to">Zoomable, sanitized viewer</div></div>
        <div class="render-card"><div class="icon">&#x1F4C4;</div><div class="from">PDF</div><div class="to">Embedded document viewer</div></div>
        <div class="render-card"><div class="icon">&#x1F4C8;</div><div class="from">Mermaid</div><div class="to">Rendered diagrams</div></div>
      </div>
    </section>

    <section class="demos" id="demos">
      <h2>Live demos</h2>
      <p class="sub">Real content, published via the API. Click to explore each renderer.</p>
      <div class="demo-grid">
        <a class="demo-card" href="/s/haze-chip-578a" target="_blank">
          <div class="demo-preview">&#x1F4DD;</div>
          <div class="demo-info">
            <div class="demo-type">Markdown</div>
            <div class="demo-title">Product Launch Recap</div>
            <div class="demo-desc">Headings, tables, code blocks, blockquotes</div>
          </div>
        </a>
        <a class="demo-card" href="/s/vine-node-9723" target="_blank">
          <div class="demo-preview">&#x1F4CA;</div>
          <div class="demo-info">
            <div class="demo-type">CSV</div>
            <div class="demo-title">Q1 2026 Sales Report</div>
            <div class="demo-desc">Sortable table with 18 rows of sales data</div>
          </div>
        </a>
        <a class="demo-card" href="/s/sage-dust-d42e" target="_blank">
          <div class="demo-preview">&#x1F333;</div>
          <div class="demo-info">
            <div class="demo-type">JSON</div>
            <div class="demo-title">API Response Explorer</div>
            <div class="demo-desc">Nested user profile with collapsible tree</div>
          </div>
        </a>
        <a class="demo-card" href="/s/rain-link-4853" target="_blank">
          <div class="demo-preview">&#x2B50;</div>
          <div class="demo-info">
            <div class="demo-type">SVG</div>
            <div class="demo-title">Revenue by Region</div>
            <div class="demo-desc">Bar chart with gradients and labels</div>
          </div>
        </a>
        <a class="demo-card" href="/s/warm-hawk-f63a" target="_blank">
          <div class="demo-preview">&#x1F4C8;</div>
          <div class="demo-info">
            <div class="demo-type">Mermaid</div>
            <div class="demo-title">System Architecture</div>
            <div class="demo-desc">19-node flowchart with colored styles</div>
          </div>
        </a>
      </div>
    </section>

    <section class="how">
      <h2>How it works</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text"><strong>Agent creates content</strong><span>CSV report, markdown doc, JSON data, diagram — anything</span></div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text"><strong>One API call to tinycloud</strong><span>MCP tool, REST API, or inline publish — zero config, no accounts</span></div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text"><strong>Beautiful shareable URL</strong><span>Auto-rendered with the right viewer. Share anywhere instantly.</span></div>
        </div>
      </div>
    </section>

    <section class="features">
      <h2>Built for AI agents</h2>
      <div class="feat-grid">
        <div class="feat"><h3>MCP Native</h3><p>First-class tool integration. One call from Claude, GPT, or any agent &rarr; live URL.</p></div>
        <div class="feat"><h3>Smart Rendering</h3><p>Auto-detects content type and picks the best interactive viewer. No config.</p></div>
        <div class="feat"><h3>Zero Config</h3><p>No accounts, no API keys, no setup. Anonymous publish with 7-day TTL.</p></div>
        <div class="feat"><h3>Edge Served</h3><p>Cloudflare Workers + R2. Cached at the edge, fast everywhere on earth.</p></div>
        <div class="feat"><h3>Embeddable</h3><p>Add <code>?embed=1</code> to any URL for a clean iframe-ready view.</p></div>
        <div class="feat"><h3>Open Source</h3><p>MIT licensed. Self-host on your own Cloudflare account in minutes.</p></div>
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

// ─────────────────────────────────────────────
// Documentation page — /docs
// ─────────────────────────────────────────────

export function docsPageHtml(domain: string): string {
  const api = `api.${domain}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>easl docs — API Reference &amp; Getting Started</title>
  <meta name="description" content="Complete documentation for easl: smart rendering for AI agent output. API reference, MCP server setup, inline publish.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <script>(function(){var t=localStorage.getItem('easl-theme')||(matchMedia('(prefers-color-scheme:light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t)})()</script>
  <style>
    :root{--bg:#0a0a0a;--bg-sidebar:#0f0f0f;--bg-code:#111;--bg-code-inline:#1a1a1a;--border:#1a1a1a;--border-code:#1e1e1e;--border-hover:#333;--text:#e5e5e5;--text-heading:#fff;--text-muted:#a3a3a3;--text-faint:#737373;--text-faintest:#525252;--text-subtle:#d4d4d4;--accent:#60a5fa;--green:#34d399;--yellow:#fbbf24;--pink:#f472b6;--red:#f87171;--method-post-bg:#1e3a5f;--method-get-bg:#1a3f2a;--method-del-bg:#3f1a1a;--badge-req-bg:#3f1a1a;--badge-opt-bg:#1a1a1a;--sidebar-active-bg:#111;--sidebar-hover-bg:#1a1a1a;--nav-bg:rgba(10,10,10,0.95);--logo-invert:0}
    [data-theme="light"]{--bg:#fafafa;--bg-sidebar:#f5f5f5;--bg-code:#f0f0f0;--bg-code-inline:#e8e8e8;--border:#e0e0e0;--border-code:#d4d4d4;--border-hover:#bbb;--text:#1a1a1a;--text-heading:#000;--text-muted:#525252;--text-faint:#737373;--text-faintest:#a3a3a3;--text-subtle:#333;--accent:#2563eb;--green:#059669;--yellow:#d97706;--pink:#db2777;--red:#dc2626;--method-post-bg:#dbeafe;--method-get-bg:#d1fae5;--method-del-bg:#fee2e2;--badge-req-bg:#fee2e2;--badge-opt-bg:#f0f0f0;--sidebar-active-bg:#e8e8e8;--sidebar-hover-bg:#ebebeb;--nav-bg:rgba(250,250,250,0.95);--logo-invert:1}
    *{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased;transition:background .2s,color .2s}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    code{font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:0.875em;background:var(--bg-code-inline);padding:2px 6px;border-radius:3px;color:var(--text)}

    /* Layout */
    .wrapper{display:flex;min-height:100vh}
    .sidebar{width:240px;position:fixed;top:0;left:0;bottom:0;background:var(--bg-sidebar);border-right:1px solid var(--border);padding:1.5rem 0;overflow-y:auto;z-index:50}
    .sidebar .logo{padding:0 1.5rem;margin-bottom:1.5rem;display:block;text-decoration:none!important}
    .sidebar .logo img{filter:invert(var(--logo-invert))}
    .sidebar nav{padding:0}
    .sidebar .group{margin-bottom:1rem}
    .sidebar .group-title{font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-faintest);padding:0 1.5rem;margin-bottom:0.375rem}
    .sidebar a{display:block;padding:0.3125rem 1.5rem;font-size:0.8125rem;color:var(--text-muted);transition:all .1s;text-decoration:none!important;border-left:2px solid transparent}
    .sidebar a:hover{color:var(--text-heading);background:var(--sidebar-hover-bg)}
    .sidebar a.active{color:var(--accent);border-left-color:var(--accent);background:var(--sidebar-active-bg)}
    .sidebar .theme-toggle{margin:1rem 1.5rem 0;background:none;border:1px solid var(--border);border-radius:6px;padding:0.3rem 0.75rem;cursor:pointer;color:var(--text-muted);font-size:0.75rem;transition:all .15s;display:flex;align-items:center;gap:0.375rem}
    .sidebar .theme-toggle:hover{border-color:var(--border-hover);color:var(--text-heading)}
    .main{margin-left:240px;flex:1;min-width:0}
    .content{max-width:760px;padding:2.5rem 3rem 4rem}

    /* Typography */
    h1{font-size:2rem;font-weight:800;letter-spacing:-0.03em;margin-bottom:0.5rem;color:var(--text-heading)}
    h2{font-size:1.375rem;font-weight:700;letter-spacing:-0.02em;margin:3rem 0 1rem;color:var(--text-heading);padding-top:1rem;border-top:1px solid var(--border)}
    h2:first-of-type{border-top:none;margin-top:2rem}
    h3{font-size:1.0625rem;font-weight:600;margin:2rem 0 0.75rem;color:var(--text)}
    h4{font-size:0.9375rem;font-weight:600;margin:1.5rem 0 0.5rem;color:var(--text-subtle)}
    p{margin-bottom:1rem;color:var(--text-muted)}
    .lead{font-size:1.125rem;color:var(--text-faint);margin-bottom:2rem}

    /* Code blocks */
    pre{background:var(--bg-code);border:1px solid var(--border-code);border-radius:8px;padding:1rem 1.25rem;overflow-x:auto;margin:0 0 1.25rem;font-size:0.8125rem;line-height:1.7;color:var(--text-subtle);tab-size:2}
    pre .c{color:var(--text-faintest)}
    pre .k{color:var(--accent)}
    pre .s{color:var(--green)}
    pre .n{color:var(--yellow)}
    pre .h{color:var(--pink)}

    /* Endpoint blocks */
    .endpoint{margin:1.5rem 0;padding:1.25rem;background:var(--bg-code);border:1px solid var(--border-code);border-radius:8px}
    .endpoint .method-path{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;font-size:0.9375rem}
    .method{font-size:0.75rem;font-weight:700;padding:3px 8px;border-radius:4px;letter-spacing:0.03em;font-family:inherit}
    .method-post{background:var(--method-post-bg);color:var(--accent)}
    .method-get{background:var(--method-get-bg);color:var(--green)}
    .method-delete{background:var(--method-del-bg);color:var(--red)}
    .endpoint .path{font-family:'SF Mono',monospace;font-weight:600;color:var(--text)}
    .endpoint .desc{font-size:0.8125rem;color:var(--text-faint);margin-bottom:0}
    .endpoint .auth{font-size:0.75rem;color:var(--text-faintest);margin-top:0.375rem}

    /* Tables */
    table{width:100%;border-collapse:collapse;margin:1rem 0 1.5rem;font-size:0.8125rem}
    th,td{text-align:left;padding:0.625rem 1rem;border-bottom:1px solid var(--border)}
    th{color:var(--text-faint);font-weight:500;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em}
    td{color:var(--text-muted)}
    td code{font-size:0.75rem}

    /* Badges */
    .badge{display:inline-block;font-size:0.6875rem;padding:2px 8px;border-radius:99px;font-weight:600}
    .badge-required{background:var(--badge-req-bg);color:var(--red)}
    .badge-optional{background:var(--badge-opt-bg);color:var(--text-faint)}

    /* Steps */
    .steps{counter-reset:step}
    .step{counter-increment:step;position:relative;padding-left:2.5rem;margin-bottom:1.5rem}
    .step::before{content:counter(step);position:absolute;left:0;top:0;width:1.75rem;height:1.75rem;background:var(--bg-code);border:1px solid var(--border-hover);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:var(--accent)}

    /* Mobile */
    @media(max-width:768px){
      .sidebar{display:none}
      .main{margin-left:0}
      .content{padding:1.5rem}
      h1{font-size:1.5rem}
    }
    .mobile-nav{display:none;position:fixed;top:0;left:0;right:0;z-index:100;background:var(--nav-bg);backdrop-filter:blur(12px);padding:0.75rem 1.5rem;border-bottom:1px solid var(--border);align-items:center;justify-content:space-between}
    .mobile-nav .logo img{filter:invert(var(--logo-invert))}
    .mobile-nav .theme-toggle{background:none;border:1px solid var(--border);border-radius:6px;padding:0.25rem 0.5rem;cursor:pointer;color:var(--text-muted);font-size:0.875rem;line-height:1}
    @media(max-width:768px){.mobile-nav{display:flex}.content{padding-top:4rem}}
  </style>
</head>
<body>
  <div class="mobile-nav">
    <a href="https://${domain}" class="logo"><img src="/logo.svg" alt="easl" height="18"></a>
    <button class="theme-toggle" onclick="toggleTheme()" id="theme-btn-mobile"></button>
  </div>

  <div class="wrapper">
    <aside class="sidebar">
      <a href="https://${domain}" class="logo"><img src="/logo.svg" alt="easl" height="20"></a>
      <nav>
        <div class="group">
          <div class="group-title">Getting Started</div>
          <a href="#overview">Overview</a>
          <a href="#quickstart">Quick Start</a>
          <a href="#inline-publish">Inline Publish</a>
        </div>
        <div class="group">
          <div class="group-title">Integrations</div>
          <a href="#mcp-server">MCP Server</a>
          <a href="#rest-api">REST API</a>
          <a href="#curl">cURL Examples</a>
        </div>
        <div class="group">
          <div class="group-title">API Reference</div>
          <a href="#publish-endpoints">Publishing</a>
          <a href="#finalize-endpoint">Finalize</a>
          <a href="#site-endpoints">Site Management</a>
        </div>
        <div class="group">
          <div class="group-title">Renderers</div>
          <a href="#smart-rendering">Smart Rendering</a>
          <a href="#supported-types">Supported Types</a>
          <a href="#embed-mode">Embed Mode</a>
        </div>
        <div class="group">
          <div class="group-title">Concepts</div>
          <a href="#anonymous-sites">Anonymous Sites</a>
          <a href="#rate-limits">Rate Limits</a>
          <a href="#errors">Error Codes</a>
        </div>
      </nav>
      <button class="theme-toggle" onclick="toggleTheme()" id="theme-btn-sidebar"></button>
    </aside>

    <div class="main">
      <div class="content">
        <h1 id="overview">easl docs</h1>
        <p class="lead">One API call turns raw agent output into a beautiful, shareable URL.</p>

        <p>easl is a smart rendering layer for AI agents. Upload a CSV, Markdown file, JSON blob, or any supported content — easl detects the type and renders it with the best interactive viewer. No accounts required.</p>

        <table>
          <tbody>
            <tr><td><strong>API Base</strong></td><td><code>https://${api}</code></td></tr>
            <tr><td><strong>Sites served at</strong></td><td><code>https://{slug}.${domain}</code></td></tr>
            <tr><td><strong>Anonymous limit</strong></td><td>50 files, 200 MB, expires in 7 days</td></tr>
            <tr><td><strong>Inline limit</strong></td><td>256 KB content, single file</td></tr>
          </tbody>
        </table>

        <!-- ───── Quick Start ───── -->
        <h2 id="quickstart">Quick Start</h2>
        <p>The fastest way to publish: inline publish. One API call, content in the body, live URL in the response.</p>

<pre><span class="k">curl</span> -X POST https://${api}/publish/inline \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{
    "content": "# Hello World\\nSome **markdown** here.",
    "contentType": "text/markdown",
    "title": "My First Page"
  }'</span>

<span class="c"># Response:</span>
{
  <span class="s">"url"</span>: <span class="s">"https://warm-dawn.${domain}"</span>,
  <span class="s">"slug"</span>: <span class="s">"warm-dawn"</span>,
  <span class="s">"expiresAt"</span>: <span class="s">"2026-03-30T..."</span>
}</pre>

        <p>That's it. Your content is live and beautifully rendered.</p>

        <!-- ───── Inline Publish ───── -->
        <h2 id="inline-publish">Inline Publish (One-Call Magic)</h2>
        <p>The simplest publish method. Send content as a string, get a URL back instantly. No file uploads, no finalize step.</p>

        <h3>Supported content types</h3>
        <table>
          <thead><tr><th>contentType</th><th>Rendered as</th></tr></thead>
          <tbody>
            <tr><td><code>text/markdown</code></td><td>Styled prose with headings, code, tables, blockquotes</td></tr>
            <tr><td><code>text/csv</code></td><td>Sortable, filterable interactive table</td></tr>
            <tr><td><code>application/json</code></td><td>Collapsible tree viewer with syntax highlighting</td></tr>
            <tr><td><code>text/html</code></td><td>Served as-is</td></tr>
            <tr><td><code>image/svg+xml</code></td><td>Zoomable, sanitized SVG viewer</td></tr>
            <tr><td><code>text/x-mermaid</code></td><td>Rendered Mermaid diagram (flowchart, sequence, etc.)</td></tr>
            <tr><td><code>text/plain</code></td><td>Monospaced text viewer</td></tr>
          </tbody>
        </table>

        <h3>Examples</h3>

        <h4>CSV &rarr; Interactive Table</h4>
<pre><span class="k">curl</span> -X POST https://${api}/publish/inline \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{
    "content": "Name,Role,City\\nAlice,Engineer,SF\\nBob,Designer,NYC",
    "contentType": "text/csv",
    "title": "Team Directory"
  }'</span></pre>

        <h4>JSON &rarr; Tree Viewer</h4>
<pre><span class="k">curl</span> -X POST https://${api}/publish/inline \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{
    "content": "{\\"users\\": [{\\"name\\": \\"Alice\\", \\"active\\": true}]}",
    "contentType": "application/json",
    "title": "API Response"
  }'</span></pre>

        <h4>Mermaid &rarr; Rendered Diagram</h4>
<pre><span class="k">curl</span> -X POST https://${api}/publish/inline \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{
    "content": "graph TD\\n  A[Start] --> B{Decision}\\n  B -->|Yes| C[Do it]\\n  B -->|No| D[Skip]",
    "contentType": "text/x-mermaid",
    "title": "My Flowchart"
  }'</span></pre>

        <!-- ───── MCP Server ───── -->
        <h2 id="mcp-server">MCP Server</h2>
        <p>The MCP server lets AI agents publish content natively through the Model Context Protocol. Zero shell commands.</p>

        <h3>Installation</h3>
        <p>Add to your MCP configuration (Claude Desktop, Cursor, etc.):</p>
<pre>{
  <span class="s">"mcpServers"</span>: {
    <span class="s">"easl"</span>: {
      <span class="s">"command"</span>: <span class="s">"npx"</span>,
      <span class="s">"args"</span>: [<span class="s">"-y"</span>, <span class="s">"@easl/mcp-server"</span>]
    }
  }
}</pre>

        <h3>Available tools</h3>
        <table>
          <thead><tr><th>Tool</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>publish_content</code></td><td>Publish raw content (string) &rarr; beautiful URL. The killer tool.</td></tr>
            <tr><td><code>publish_file</code></td><td>Publish a file from disk with presigned upload</td></tr>
            <tr><td><code>publish_site</code></td><td>Publish a multi-file site (directory)</td></tr>
            <tr><td><code>list_sites</code></td><td>List published sites in this session</td></tr>
            <tr><td><code>delete_site</code></td><td>Delete a published site</td></tr>
          </tbody>
        </table>

        <h3>Usage</h3>
        <p>Once configured, just ask your AI agent naturally:</p>
<pre><span class="c">// Your agent can now:</span>
"Publish this CSV as a shareable table"
"Turn this markdown into a beautiful page"
"Show me this JSON in a tree view"
"Create a Mermaid diagram of the architecture"</pre>

        <!-- ───── REST API ───── -->
        <h2 id="rest-api">REST API</h2>
        <p>Base URL: <code>https://${api}</code></p>

        <h3 id="publish-endpoints">Publishing</h3>

        <div class="endpoint">
          <div class="method-path"><span class="method method-post">POST</span> <span class="path">/publish/inline</span></div>
          <p class="desc">One-call publish. Send content as a string, get a live URL back instantly. No upload step needed.</p>
          <p class="auth">Auth: None required (anonymous, 7-day TTL)</p>
        </div>

        <h4>Request body</h4>
        <table>
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>content</code></td><td>string <span class="badge badge-required">required</span></td><td>Raw content string (max 256 KB)</td></tr>
            <tr><td><code>contentType</code></td><td>string <span class="badge badge-required">required</span></td><td>MIME type (e.g. <code>text/markdown</code>)</td></tr>
            <tr><td><code>title</code></td><td>string <span class="badge badge-optional">optional</span></td><td>Page title shown in header &amp; browser tab</td></tr>
            <tr><td><code>template</code></td><td>string <span class="badge badge-optional">optional</span></td><td>Template: <code>minimal</code>, <code>report</code>, or <code>dashboard</code></td></tr>
          </tbody>
        </table>

        <h4>Response (201)</h4>
<pre>{
  <span class="s">"url"</span>: <span class="s">"https://warm-dawn.${domain}"</span>,
  <span class="s">"slug"</span>: <span class="s">"warm-dawn"</span>,
  <span class="s">"claimToken"</span>: <span class="s">"claim_..."</span>,
  <span class="s">"embed"</span>: <span class="s">"&lt;iframe src=\\"...?embed=1\\" ...&gt;&lt;/iframe&gt;"</span>,
  <span class="s">"shareText"</span>: <span class="s">"My Page: https://warm-dawn.${domain}"</span>,
  <span class="s">"expiresAt"</span>: <span class="s">"2026-03-30T12:00:00Z"</span>,
  <span class="s">"anonymous"</span>: <span class="n">true</span>
}</pre>

        <div class="endpoint">
          <div class="method-path"><span class="method method-post">POST</span> <span class="path">/publish</span></div>
          <p class="desc">Multi-file publish. Returns presigned R2 upload URLs for each file. Call <code>/finalize</code> after uploads complete.</p>
          <p class="auth">Auth: None required</p>
        </div>

        <h4>Request body</h4>
        <table>
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>files</code></td><td>array <span class="badge badge-required">required</span></td><td>Array of <code>{path, size, contentType}</code></td></tr>
            <tr><td><code>slug</code></td><td>string <span class="badge badge-optional">optional</span></td><td>Custom slug (3-48 chars, lowercase alphanumeric + hyphens)</td></tr>
            <tr><td><code>title</code></td><td>string <span class="badge badge-optional">optional</span></td><td>Site title</td></tr>
            <tr><td><code>template</code></td><td>string <span class="badge badge-optional">optional</span></td><td>Template name</td></tr>
            <tr><td><code>ttl</code></td><td>number <span class="badge badge-optional">optional</span></td><td>TTL in seconds (default: 7 days)</td></tr>
          </tbody>
        </table>

        <h4>Response (201)</h4>
<pre>{
  <span class="s">"slug"</span>: <span class="s">"bold-arch"</span>,
  <span class="s">"url"</span>: <span class="s">"https://bold-arch.${domain}"</span>,
  <span class="s">"claimToken"</span>: <span class="s">"claim_..."</span>,
  <span class="s">"upload"</span>: {
    <span class="s">"versionId"</span>: <span class="s">"v_abc123"</span>,
    <span class="s">"uploads"</span>: [
      {
        <span class="s">"path"</span>: <span class="s">"index.html"</span>,
        <span class="s">"method"</span>: <span class="s">"PUT"</span>,
        <span class="s">"url"</span>: <span class="s">"https://presigned-url..."</span>,
        <span class="s">"headers"</span>: { <span class="s">"Content-Type"</span>: <span class="s">"text/html"</span> }
      }
    ],
    <span class="s">"finalizeUrl"</span>: <span class="s">"https://${api}/finalize/bold-arch"</span>,
    <span class="s">"expiresInSeconds"</span>: <span class="n">600</span>
  },
  <span class="s">"expiresAt"</span>: <span class="s">"2026-03-30T..."</span>,
  <span class="s">"anonymous"</span>: <span class="n">true</span>
}</pre>

        <!-- Finalize -->
        <h3 id="finalize-endpoint">Finalize</h3>

        <div class="endpoint">
          <div class="method-path"><span class="method method-post">POST</span> <span class="path">/finalize/:slug</span></div>
          <p class="desc">Activate a site after uploading all files via presigned URLs. Verifies all files exist in R2.</p>
          <p class="auth">Auth: None required</p>
        </div>

        <h4>Request body</h4>
        <table>
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>versionId</code></td><td>string <span class="badge badge-required">required</span></td><td>The version ID from the publish response</td></tr>
          </tbody>
        </table>

        <!-- Site Management -->
        <h3 id="site-endpoints">Site Management</h3>

        <div class="endpoint">
          <div class="method-path"><span class="method method-get">GET</span> <span class="path">/sites/:slug</span></div>
          <p class="desc">Get site metadata including title, files, version, and expiry.</p>
          <p class="auth">Auth: None required</p>
        </div>

        <div class="endpoint">
          <div class="method-path"><span class="method method-delete">DELETE</span> <span class="path">/sites/:slug</span></div>
          <p class="desc">Delete a site. Requires the claim token from the original publish response.</p>
          <p class="auth">Auth: <code>X-Claim-Token</code> header</p>
        </div>

        <!-- ───── cURL Examples ───── -->
        <h2 id="curl">cURL Examples</h2>

        <h3>Publish markdown</h3>
<pre><span class="k">curl</span> -X POST https://${api}/publish/inline \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"content":"# Report\\n\\nQ1 was great.","contentType":"text/markdown"}'</span></pre>

        <h3>Publish CSV</h3>
<pre><span class="k">curl</span> -X POST https://${api}/publish/inline \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"content":"Name,Score\\nAlice,95\\nBob,87","contentType":"text/csv"}'</span></pre>

        <h3>Multi-file publish</h3>
<pre><span class="c"># Step 1: Create site</span>
<span class="k">curl</span> -X POST https://${api}/publish \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"files":[{"path":"index.html","size":1024,"contentType":"text/html"}]}'</span>

<span class="c"># Step 2: Upload to presigned URL</span>
<span class="k">curl</span> -X PUT <span class="n">"PRESIGNED_URL"</span> \\
  -H <span class="s">"Content-Type: text/html"</span> \\
  --data-binary <span class="s">@index.html</span>

<span class="c"># Step 3: Finalize</span>
<span class="k">curl</span> -X POST https://${api}/finalize/<span class="n">YOUR_SLUG</span> \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"versionId":"VERSION_ID"}'</span></pre>

        <!-- ───── Smart Rendering ───── -->
        <h2 id="smart-rendering">Smart Rendering</h2>
        <p>easl's core feature. When a site is served, the Worker detects the file type and generates an HTML shell with the right interactive viewer. The raw data is embedded as JSON in a <code>&lt;script&gt;</code> tag, and client-side JavaScript hydrates it into a rich viewer.</p>

        <h3 id="supported-types">Supported Types</h3>
        <table>
          <thead><tr><th>File Type</th><th>Detection</th><th>Viewer</th></tr></thead>
          <tbody>
            <tr><td>CSV</td><td><code>.csv</code> or <code>text/csv</code></td><td>Sortable table with column click-to-sort, alternating rows, sticky header</td></tr>
            <tr><td>Markdown</td><td><code>.md</code> or <code>text/markdown</code></td><td>Styled prose — headings, lists, code blocks, blockquotes, tables, images</td></tr>
            <tr><td>JSON</td><td><code>.json</code> or <code>application/json</code></td><td>Collapsible/expandable tree with syntax coloring and expand-all/collapse-all</td></tr>
            <tr><td>HTML</td><td><code>.html</code> or <code>text/html</code></td><td>Served as-is (no wrapping, no viewer)</td></tr>
            <tr><td>Images</td><td><code>.png/.jpg/.gif/.webp</code></td><td>Responsive centered image with max-width</td></tr>
            <tr><td>SVG</td><td><code>.svg</code> or <code>image/svg+xml</code></td><td>Sanitized (scripts stripped), zoomable viewer</td></tr>
            <tr><td>PDF</td><td><code>.pdf</code></td><td>Embedded iframe viewer</td></tr>
            <tr><td>Mermaid</td><td><code>.mmd</code> or <code>text/x-mermaid</code></td><td>Rendered diagram via Mermaid.js CDN</td></tr>
          </tbody>
        </table>

        <h3 id="embed-mode">Embed Mode</h3>
        <p>Add <code>?embed=1</code> to any site URL to get a clean, headerless version suitable for iframes:</p>
<pre>&lt;iframe
  src=<span class="s">"https://warm-dawn.${domain}?embed=1"</span>
  width=<span class="s">"100%"</span>
  height=<span class="s">"500"</span>
  frameborder=<span class="s">"0"</span>
&gt;&lt;/iframe&gt;</pre>
        <p>The embed URL is also returned in the <code>embed</code> field of the publish response.</p>

        <!-- ───── Concepts ───── -->
        <h2 id="anonymous-sites">Anonymous Sites</h2>
        <p>No account needed. Publish instantly and get a live URL.</p>
        <table>
          <thead><tr><th>Limit</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Lifetime</td><td>7 days</td></tr>
            <tr><td>Max files per site</td><td>50</td></tr>
            <tr><td>Max total size</td><td>200 MB</td></tr>
            <tr><td>Inline content limit</td><td>256 KB</td></tr>
          </tbody>
        </table>
        <p>Each publish returns a <code>claimToken</code> — save it if you need to delete the site later. Send it as the <code>X-Claim-Token</code> header on <code>DELETE /sites/:slug</code>.</p>

        <h2 id="rate-limits">Rate Limits</h2>
        <p>Publish endpoints are rate-limited per IP.</p>
        <table>
          <thead><tr><th>Endpoint</th><th>Limit</th><th>Window</th></tr></thead>
          <tbody>
            <tr><td><code>/publish</code></td><td>5 requests</td><td>1 hour</td></tr>
            <tr><td><code>/publish/inline</code></td><td>10 requests</td><td>1 hour</td></tr>
          </tbody>
        </table>

        <h2 id="errors">Error Codes</h2>
        <table>
          <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>400</code></td><td>Bad request — missing or invalid parameters</td></tr>
            <tr><td><code>404</code></td><td>Not found — site or version doesn't exist</td></tr>
            <tr><td><code>409</code></td><td>Conflict — slug taken or version mismatch</td></tr>
            <tr><td><code>422</code></td><td>Unprocessable — files missing from R2 during finalize</td></tr>
            <tr><td><code>429</code></td><td>Rate limited — try again later</td></tr>
            <tr><td><code>500</code></td><td>Server error</td></tr>
          </tbody>
        </table>

      </div>
    </div>
  </div>
  <script>
    function getTheme(){return localStorage.getItem('easl-theme')||(matchMedia('(prefers-color-scheme:light)').matches?'light':'dark')}
    function applyTheme(t){document.documentElement.setAttribute('data-theme',t);var icon=t==='dark'?'\u2600':'\u263E';document.querySelectorAll('[id^="theme-btn"]').forEach(function(b){b.textContent=icon})}
    function toggleTheme(){var t=getTheme()==='dark'?'light':'dark';localStorage.setItem('easl-theme',t);applyTheme(t)}
    applyTheme(getTheme());
  </script>
</body>
</html>`;
}

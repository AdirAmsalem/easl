import type { ViewerType } from "../../lib/mime";

export interface TemplateData {
  title: string;
  slug: string;
  domain: string;
  contentType: string;
  viewerType: ViewerType;
  dataJson: string;
  template: string | null;
}

// Base CSS shared across all templates
const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #fafafa;
    color: #1a1a1a;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }
  .el-header {
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #e5e5e5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fff;
  }
  .el-header h1 {
    font-size: 1rem;
    font-weight: 600;
    color: #1a1a1a;
  }
  .el-badge {
    font-size: 0.6875rem;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    background: #f0f0f0;
    color: #737373;
    text-decoration: none;
  }
  .el-badge:hover { background: #e5e5e5; }
  .el-body { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
`;

// Viewer-specific CSS
const VIEWER_CSS: Record<ViewerType, string> = {
  csv: `
    .el-table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #e5e5e5; }
    th { background: #f5f5f5; font-weight: 600; color: #525252; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; user-select: none; position: sticky; top: 0; }
    th:hover { background: #eee; }
    tr:hover td { background: #fafafa; }
    .el-controls { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .el-search { padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; min-width: 240px; }
    .el-search:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
    .el-count { font-size: 0.8125rem; color: #737373; }
    .el-sort-icon { margin-left: 0.25rem; opacity: 0.4; }
    .el-sort-icon.active { opacity: 1; color: #4f46e5; }
  `,
  markdown: `
    .el-prose { max-width: 720px; margin: 0 auto; }
    .el-prose h1 { font-size: 2rem; font-weight: 700; margin: 2rem 0 1rem; letter-spacing: -0.02em; }
    .el-prose h2 { font-size: 1.5rem; font-weight: 600; margin: 1.75rem 0 0.75rem; letter-spacing: -0.01em; }
    .el-prose h3 { font-size: 1.25rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
    .el-prose p { margin: 0 0 1rem; }
    .el-prose ul, .el-prose ol { margin: 0 0 1rem; padding-left: 1.5rem; }
    .el-prose li { margin: 0.25rem 0; }
    .el-prose code { background: #f0f0f0; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.875em; }
    .el-prose pre { background: #1a1a1a; color: #e5e5e5; padding: 1rem 1.25rem; border-radius: 8px; overflow-x: auto; margin: 0 0 1rem; }
    .el-prose pre code { background: none; padding: 0; font-size: 0.8125rem; line-height: 1.7; }
    .el-prose blockquote { border-left: 3px solid #4f46e5; padding-left: 1rem; color: #525252; margin: 0 0 1rem; }
    .el-prose a { color: #4f46e5; text-decoration: none; }
    .el-prose a:hover { text-decoration: underline; }
    .el-prose img { max-width: 100%; border-radius: 8px; margin: 1rem 0; }
    .el-prose table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    .el-prose th, .el-prose td { padding: 0.5rem 0.75rem; border: 1px solid #e5e5e5; text-align: left; }
    .el-prose th { background: #f5f5f5; font-weight: 600; }
    .el-prose hr { border: none; border-top: 1px solid #e5e5e5; margin: 2rem 0; }
  `,
  json: `
    .el-json { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.8125rem; line-height: 1.7; }
    .el-json-key { color: #4f46e5; }
    .el-json-string { color: #059669; }
    .el-json-number { color: #d97706; }
    .el-json-bool { color: #dc2626; }
    .el-json-null { color: #737373; }
    .el-json-toggle { cursor: pointer; user-select: none; }
    .el-json-toggle:hover { background: #f0f0f0; border-radius: 2px; }
    .el-json-collapsed .el-json-children { display: none; }
    .el-json-collapsed .el-json-preview { display: inline; }
    .el-json-preview { display: none; color: #a3a3a3; font-style: italic; }
    .el-json-bracket { color: #525252; }
  `,
  html: "",
  image: `
    .el-gallery { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); padding: 2rem; }
    .el-gallery img { max-width: 100%; max-height: calc(100vh - 120px); object-fit: contain; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: zoom-in; }
    .el-gallery img.zoomed { cursor: zoom-out; max-width: none; max-height: none; }
    .el-gallery-controls { display: flex; gap: 0.5rem; position: fixed; bottom: 1.5rem; right: 1.5rem; }
    .el-gallery-btn { padding: 0.5rem 0.75rem; background: #fff; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 0.8125rem; }
    .el-gallery-btn:hover { background: #f5f5f5; }
  `,
  pdf: `
    .el-pdf { width: 100%; height: calc(100vh - 60px); }
    .el-pdf iframe { width: 100%; height: 100%; border: none; }
  `,
  svg: `
    .el-svg-viewer { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); padding: 2rem; overflow: hidden; }
    .el-svg-viewer svg { max-width: 100%; max-height: calc(100vh - 120px); }
    .el-svg-controls { display: flex; gap: 0.5rem; position: fixed; bottom: 1.5rem; right: 1.5rem; }
    .el-svg-btn { padding: 0.5rem 0.75rem; background: #fff; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 0.8125rem; }
    .el-svg-btn:hover { background: #f5f5f5; }
  `,
  mermaid: `
    .el-mermaid { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); padding: 2rem; }
    .el-mermaid-output { max-width: 100%; overflow: auto; }
  `,
  download: `
    .el-download { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); text-align: center; }
    .el-download-card { padding: 3rem; background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; }
    .el-download-icon { font-size: 3rem; margin-bottom: 1rem; }
    .el-download-name { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem; }
    .el-download-meta { font-size: 0.875rem; color: #737373; margin-bottom: 1.5rem; }
    .el-download-btn { display: inline-block; padding: 0.75rem 1.5rem; background: #4f46e5; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
    .el-download-btn:hover { background: #4338ca; }
  `,
};

// Viewer-specific client JS
const VIEWER_JS: Record<ViewerType, string> = {
  csv: `
    (function() {
      const raw = document.getElementById('el-data').textContent;
      const rows = parseCSV(raw);
      if (rows.length === 0) return;
      const headers = rows[0];
      const data = rows.slice(1);
      let sortCol = -1, sortAsc = true;
      let filtered = data;

      const container = document.getElementById('el-viewer');
      container.innerHTML = '<div class="el-controls"><input class="el-search" placeholder="Search..." id="el-search"><span class="el-count" id="el-count"></span></div><div class="el-table-wrap"><table><thead id="el-thead"></thead><tbody id="el-tbody"></tbody></table></div>';

      render();

      document.getElementById('el-search').addEventListener('input', function(e) {
        const q = e.target.value.toLowerCase();
        filtered = q ? data.filter(r => r.some(c => c.toLowerCase().includes(q))) : data;
        render();
      });

      function render() {
        const thead = document.getElementById('el-thead');
        thead.innerHTML = '<tr>' + headers.map((h, i) => '<th onclick="window.__elSort(' + i + ')">' + esc(h) + '<span class="el-sort-icon' + (sortCol === i ? ' active' : '') + '">' + (sortCol === i ? (sortAsc ? ' ▲' : ' ▼') : ' ⇅') + '</span></th>').join('') + '</tr>';

        const tbody = document.getElementById('el-tbody');
        const sorted = sortCol >= 0 ? [...filtered].sort((a, b) => {
          const av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
          const an = Number(av), bn = Number(bv);
          if (!isNaN(an) && !isNaN(bn)) return sortAsc ? an - bn : bn - an;
          return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        }) : filtered;

        tbody.innerHTML = sorted.map(r => '<tr>' + headers.map((_, i) => '<td>' + esc(r[i] ?? '') + '</td>').join('') + '</tr>').join('');
        document.getElementById('el-count').textContent = filtered.length + ' rows';
      }

      window.__elSort = function(i) {
        if (sortCol === i) sortAsc = !sortAsc;
        else { sortCol = i; sortAsc = true; }
        render();
      };

      function parseCSV(text) {
        const lines = []; let row = []; let cell = ''; let inQuote = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQuote) {
            if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
            else if (ch === '"') inQuote = false;
            else cell += ch;
          } else {
            if (ch === '"') inQuote = true;
            else if (ch === ',' || ch === '\\t') { row.push(cell); cell = ''; }
            else if (ch === '\\n' || ch === '\\r') {
              if (ch === '\\r' && text[i+1] === '\\n') i++;
              row.push(cell); cell = '';
              if (row.length > 0 && row.some(c => c !== '')) lines.push(row);
              row = [];
            }
            else cell += ch;
          }
        }
        row.push(cell);
        if (row.some(c => c !== '')) lines.push(row);
        return lines;
      }

      function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    })();
  `,
  markdown: `
    (function() {
      var raw = document.getElementById('el-data').textContent;
      var container = document.getElementById('el-viewer');

      // Try loading marked.js from CDN for full GFM support
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/marked@15/marked.min.js';
      script.onload = function() {
        marked.setOptions({ gfm: true, breaks: false });
        container.innerHTML = '<div class="el-prose">' + marked.parse(raw) + '</div>';
      };
      script.onerror = function() {
        // Fallback: basic regex renderer if CDN is unavailable
        container.innerHTML = '<div class="el-prose">' + fallbackRender(raw) + '</div>';
      };
      document.head.appendChild(script);

      function fallbackRender(md) {
        var html = md;
        html = html.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
          return '<pre><code>' + esc(code.trim()) + '</code></pre>';
        });
        html = html.replace(/\`([^\`]+)\`/g, function(_, c) { return '<code>' + esc(c) + '</code>'; });
        html = html.replace(/^######\\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\\s+(.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        html = html.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, function(_, alt, src) { return '<img src="' + esc(src) + '" alt="' + esc(alt) + '">'; });
        html = html.replace(/\\[([^\\]]*)\\]\\(([^)]+)\\)/g, function(_, text, href) { return '<a href="' + esc(href) + '">' + esc(text) + '</a>'; });
        html = html.replace(/^>\\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');
        html = html.replace(/^---$/gm, '<hr>');
        html = html.replace(/^[\\-\\*]\\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\\/li>\\n?)+/g, '<ul>$&</ul>');
        html = html.replace(/^(?!<[hupbloai]|<\\/)(\\S[^\\n]+)$/gm, '<p>$1</p>');
        return html;
      }

      function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    })();
  `,
  json: `
    (function() {
      const raw = document.getElementById('el-data').textContent;
      const container = document.getElementById('el-viewer');
      try {
        const data = JSON.parse(raw);
        container.innerHTML = '<div class="el-json">' + renderJson(data, 0) + '</div>';
      } catch(e) {
        container.innerHTML = '<pre style="padding:1rem;color:#dc2626">Invalid JSON: ' + e.message + '</pre>';
      }

      function renderJson(val, depth) {
        if (val === null) return '<span class="el-json-null">null</span>';
        if (typeof val === 'boolean') return '<span class="el-json-bool">' + val + '</span>';
        if (typeof val === 'number') return '<span class="el-json-number">' + val + '</span>';
        if (typeof val === 'string') return '<span class="el-json-string">"' + esc(val) + '"</span>';
        if (Array.isArray(val)) {
          if (val.length === 0) return '<span class="el-json-bracket">[]</span>';
          const id = 'n' + Math.random().toString(36).slice(2,8);
          const items = val.map((v, i) => '<div style="padding-left:1.5rem">' + renderJson(v, depth+1) + (i < val.length-1 ? ',' : '') + '</div>').join('');
          return '<span class="el-json-toggle" onclick="this.parentElement.classList.toggle(&quot;el-json-collapsed&quot;)"><span class="el-json-bracket">[</span></span><span class="el-json-preview">[' + val.length + ' items]</span><div class="el-json-children">' + items + '</div><span class="el-json-bracket">]</span>';
        }
        if (typeof val === 'object') {
          const keys = Object.keys(val);
          if (keys.length === 0) return '<span class="el-json-bracket">{}</span>';
          const entries = keys.map((k, i) => '<div style="padding-left:1.5rem"><span class="el-json-key">"' + esc(k) + '"</span>: ' + renderJson(val[k], depth+1) + (i < keys.length-1 ? ',' : '') + '</div>').join('');
          return '<span class="el-json-toggle" onclick="this.parentElement.classList.toggle(&quot;el-json-collapsed&quot;)"><span class="el-json-bracket">{</span></span><span class="el-json-preview">{' + keys.length + ' keys}</span><div class="el-json-children">' + entries + '</div><span class="el-json-bracket">}</span>';
        }
        return String(val);
      }

      function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    })();
  `,
  html: "",
  image: `
    (function() {
      const data = JSON.parse(document.getElementById('el-data').textContent);
      const container = document.getElementById('el-viewer');
      const img = document.createElement('img');
      img.src = data.url;
      img.alt = data.title || 'Image';
      img.addEventListener('click', function() { img.classList.toggle('zoomed'); });
      const wrap = document.createElement('div');
      wrap.className = 'el-gallery';
      wrap.appendChild(img);
      const controls = document.createElement('div');
      controls.className = 'el-gallery-controls';
      controls.innerHTML = '<a class="el-gallery-btn" href="' + data.url + '" download>Download</a>';
      wrap.appendChild(controls);
      container.appendChild(wrap);
    })();
  `,
  pdf: `
    (function() {
      const data = JSON.parse(document.getElementById('el-data').textContent);
      const container = document.getElementById('el-viewer');
      container.innerHTML = '<div class="el-pdf"><iframe src="' + data.url + '#toolbar=1" title="PDF Viewer"></iframe></div>';
    })();
  `,
  svg: `
    (function() {
      const raw = document.getElementById('el-data').textContent;
      const container = document.getElementById('el-viewer');
      const wrap = document.createElement('div');
      wrap.className = 'el-svg-viewer';
      // Sanitize SVG: parse in inert context, strip scripts and event handlers
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'image/svg+xml');
      const svg = doc.documentElement;
      function sanitize(el) {
        if (el.tagName === 'script' || el.tagName === 'SCRIPT') { el.remove(); return; }
        for (const attr of [...el.attributes]) {
          if (attr.name.startsWith('on') || attr.name === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:')) {
            el.removeAttribute(attr.name);
          }
        }
        for (const child of [...el.children]) sanitize(child);
      }
      sanitize(svg);
      wrap.appendChild(document.importNode(svg, true));
      container.appendChild(wrap);
    })();
  `,
  mermaid: `
    (function() {
      const raw = document.getElementById('el-data').textContent;
      const container = document.getElementById('el-viewer');
      container.innerHTML = '<div class="el-mermaid"><div class="el-mermaid-output" id="el-mermaid-output"></div></div>';
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
      script.onload = function() {
        mermaid.initialize({ startOnLoad: false, theme: 'default' });
        mermaid.render('el-mermaid-svg', raw).then(function(result) {
          document.getElementById('el-mermaid-output').innerHTML = result.svg;
        });
      };
      document.head.appendChild(script);
    })();
  `,
  download: `
    (function() {
      const data = JSON.parse(document.getElementById('el-data').textContent);
      const container = document.getElementById('el-viewer');
      const size = data.size < 1024 ? data.size + ' B' : data.size < 1048576 ? (data.size/1024).toFixed(1) + ' KB' : (data.size/1048576).toFixed(1) + ' MB';
      container.innerHTML = '<div class="el-download"><div class="el-download-card"><div class="el-download-icon">📄</div><div class="el-download-name">' + data.path + '</div><div class="el-download-meta">' + size + ' · ' + data.contentType + '</div><a class="el-download-btn" href="' + data.url + '" download>Download</a></div></div>';
    })();
  `,
};

export function generateHtmlShell(data: TemplateData): string {
  const viewerCss = VIEWER_CSS[data.viewerType] || "";
  const viewerJs = VIEWER_JS[data.viewerType] || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.title)}</title>
  <meta property="og:title" content="${escapeHtml(data.title)}">
  <meta property="og:description" content="Shared via easl">
  <meta property="og:url" content="https://${data.slug}.${data.domain}">
  <meta property="og:image" content="https://${data.slug}.${data.domain}/_easl/og.png">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(data.title)}">
  <meta name="twitter:image" content="https://${data.slug}.${data.domain}/_easl/og.png">
  <style>${BASE_CSS}${viewerCss}</style>
</head>
<body>
  <div class="el-header">
    <h1>${escapeHtml(data.title)}</h1>
    <a class="el-badge" href="https://${data.domain}">easl</a>
  </div>
  <div class="el-body">
    <div id="el-viewer"></div>
  </div>
  <script type="application/json" id="el-data">${escapeScriptClose(data.dataJson)}</script>
  <script>${viewerJs}</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Prevent </script> in embedded content from breaking out of the JSON block */
function escapeScriptClose(str: string): string {
  return str.replace(/<\//g, "<\\/");
}

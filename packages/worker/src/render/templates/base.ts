import type { ViewerType } from "../../lib/mime";

export interface TemplateData {
  title: string;
  slug: string;
  domain: string;
  contentType: string;
  viewerType: ViewerType;
  dataJson: string;
  template: string | null;
  siteBaseUrl: string;
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
  .el-header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .el-badge {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
    opacity: 0.3;
    transition: opacity 0.15s ease;
  }
  .el-badge:hover { opacity: 0.5; }
  .el-download-link {
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.375rem 0.75rem;
    border-radius: 6px;
    background: #fff;
    color: #525252;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    border: 1px solid #e5e5e5;
    transition: all 0.15s ease;
    min-height: 32px;
  }
  .el-download-link:hover { background: #f9fafb; border-color: #d1d5db; color: #1a1a1a; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  .el-download-link:active { background: #f3f4f6; transform: scale(0.97); }
  .el-download-link svg { flex-shrink: 0; }
  @media (max-width: 640px) {
    .el-download-link { min-height: 36px; padding: 0.5rem 0.75rem; }
  }
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
    .el-gallery-btn { padding: 0.5rem 0.875rem; background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; cursor: pointer; font-size: 0.8125rem; font-weight: 500; color: #525252; display: inline-flex; align-items: center; gap: 0.375rem; text-decoration: none; transition: all 0.15s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.06); min-height: 36px; }
    .el-gallery-btn:hover { background: #f9fafb; border-color: #d1d5db; color: #1a1a1a; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
    .el-gallery-btn:active { transform: scale(0.97); }
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
    .el-download { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); text-align: center; padding: 1.5rem; }
    .el-download-card { padding: 2.5rem 3rem; background: #fff; border: 1px solid #e5e5e5; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03); max-width: 400px; width: 100%; }
    .el-download-icon { margin-bottom: 1.25rem; display: flex; justify-content: center; }
    .el-download-icon svg { color: #a3a3a3; }
    .el-download-name { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; word-break: break-all; color: #1a1a1a; }
    .el-download-meta { font-size: 0.8125rem; color: #a3a3a3; margin-bottom: 1.75rem; }
    .el-download-btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.625rem 1.25rem; background: #1a1a1a; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 0.875rem; transition: all 0.15s ease; min-height: 44px; }
    .el-download-btn:hover { background: #333; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
    .el-download-btn:active { transform: scale(0.97); }
    .el-download-btn svg { flex-shrink: 0; }
    @media (max-width: 640px) { .el-download-card { padding: 2rem 1.5rem; } }
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
      controls.innerHTML = '<a class="el-gallery-btn" href="' + data.url + '" download><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8m0 0L5 7m3 3l3-3"/><path d="M3 13h10"/></svg>Download</a>';
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
      const raw = document.getElementById('el-data').textContent.split('<' + '\\\\' + '/').join('</');
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
      function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      container.innerHTML = '<div class="el-download"><div class="el-download-card"><div class="el-download-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="el-download-name">' + esc(data.path) + '</div><div class="el-download-meta">' + size + ' · ' + data.contentType + '</div><a class="el-download-btn" href="' + data.url + '" download><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8m0 0L5 7m3 3l3-3"/><path d="M3 13h10"/></svg>Download file</a></div></div>';
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
    <div class="el-header-right">
      <a class="el-download-link" href="${data.siteBaseUrl}/_easl/download" download title="Download"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8m0 0L5 7m3 3l3-3"/><path d="M3 13h10"/></svg>Download</a>
      <a class="el-badge" href="https://${data.domain}" title="easl"><svg width="40" height="14" viewBox="100 540 820 260" aria-label="easl"><path fill="#1a1a1a" d="M220.826 577.724C227.438 577.408 237.227 577.677 243.82 578.438C273.565 581.811 300.745 596.882 319.36 620.326C338.155 644.2 344.884 670.205 341.322 700.043L229.806 700.058C207.333 700.096 182.568 700.708 160.326 700.05C174.546 754.979 251.573 765.662 286.557 724.715C288.024 722.998 290.641 718.899 292.622 718.294C299.889 717.868 307.173 717.765 314.45 717.984C320.342 718.197 330.549 718.906 336.266 718.175C333.166 729.219 327.356 738.512 320.285 747.304C272.925 806.197 171.626 801.991 133.008 735.576C125.302 722.324 120.99 709.817 119.46 694.593C112.996 630.277 158.592 583.423 220.826 577.724ZM160.554 662.226C169.612 661.736 179.889 661.966 189.056 661.973L236.625 661.972C256.989 662.089 277.436 661.693 297.775 662.109C291.387 644.913 278.364 631.001 261.628 623.492C249.988 618.218 236.199 616.238 223.5 617.241C194.855 619.904 170.475 634.123 160.554 662.226Z"/><path fill="#1a1a1a" d="M689.761 577.247C692.716 577.136 697 577.5 699.993 577.729C741.043 580.879 780.36 602.472 792.975 644.012C778.961 644.483 763.811 644.127 749.333 644.482L748.021 642.909C734.056 626.323 715.933 619.166 694.561 617.327C677.455 616.061 657.947 617.626 644.2 628.964C636.868 635.012 634.382 647.276 641.299 654.462C650.806 664.338 666.341 661.764 678.795 662.018C711.892 662.694 755.339 657.562 780.426 684.117C790.719 694.864 796.259 709.298 795.802 724.172C795.423 734.777 791.969 744.563 785.859 753.184C764.65 783.108 726.036 790.309 691.876 788.946C648.149 784.41 602.263 766.63 592.48 718.33L636.56 718.461C646.4 744.423 678.368 750.325 703.018 750.366C717.779 750.391 738.242 747.957 749.055 736.709C761.224 724.05 754.761 706.776 738.547 702.461C727.753 699.361 718.423 700.63 707.436 700.296C675.737 699.338 638.289 705.285 612.653 682.213C590.628 662.39 592.234 625.886 612.532 605.483C633.404 584.503 661.282 577.899 689.761 577.247Z"/><path fill="#60a5fa" d="M434.219 655.289C471.954 651.886 520.192 670.597 552.772 688.182C559.21 691.657 568.482 697.711 574.996 701.683L575.021 742.276C564.144 738.86 546.817 729.056 537.4 722.859C509.896 704.761 479.635 693.447 446.468 692.519C431.053 692.088 413.208 695.456 401.673 706.814C392.932 715.42 388.007 729.292 398.883 738.72C410.55 748.908 426.455 751.15 441.375 750.619C460.849 750.54 482.316 743.173 497.244 730.784C500.454 728.12 504.61 724.013 508.896 723.537C517.111 722.623 525.68 729.819 526.627 737.968C527.489 745.003 524.767 751.398 520.328 756.596C502.558 777.402 474.599 786.018 448.213 788.598C420.786 791.182 396.267 786.606 374.789 768.568C362.418 758.179 354.487 744.901 353.237 728.641C352.131 713.16 357.237 697.875 367.426 686.166C383.825 667.012 409.498 657.125 434.219 655.289Z"/><path fill="#1a1a1a" d="M811.525 516.938C824.936 516.755 838.62 516.898 852.051 516.912L852.075 628.471C852.065 649.662 852.03 670.866 852.096 692.056C852.145 707.866 855.694 723.362 867.488 734.713C878.636 745.442 892.013 746.204 906.59 745.964C906.205 755.776 906.955 774.977 906.486 785.544C906.272 785.792 906.058 786.04 905.845 786.287L905.347 786.29C878.306 786.293 855.491 778.408 836.339 759.11C826.04 748.895 818.691 736.088 815.069 722.041C810.98 705.573 811.532 688.148 811.575 671.292L811.642 630.776L811.525 516.938Z"/><path fill="#1a1a1a" d="M457.03 577.214C484.009 575.295 514.229 588.818 535.439 604.847L535.864 579.219C547.39 579.161 563.973 578.524 575.063 579.248L575.036 686.201C565.625 681.195 546.933 670.805 537.504 667.685C531.737 655.34 526.826 647.581 516.966 638.292C515.073 636.741 513.158 635.216 511.224 633.716C493.977 620.596 469.782 614.36 448.399 617.563C425.812 620.946 412.416 630.709 399.123 648.363C394.312 647.771 387.135 648.59 382.083 648.489C373.864 648.324 365.773 648.097 357.552 648.219C359.926 635.727 367.314 623.295 375.725 613.908C396.249 591.003 426.632 578.798 457.03 577.214Z"/><path fill="#1a1a1a" d="M535.63 738.116C538.522 739.311 545.22 743.277 548.292 744.923C557.656 749.938 564.884 752.996 575.046 755.811L575.053 786.438C563.191 785.901 547.997 786.373 535.901 786.453C535.889 773.031 536.716 750.963 535.63 738.116Z"/></svg></a>
    </div>
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

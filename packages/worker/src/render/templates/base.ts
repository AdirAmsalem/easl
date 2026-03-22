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
  .tc-header {
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #e5e5e5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fff;
  }
  .tc-header h1 {
    font-size: 1rem;
    font-weight: 600;
    color: #1a1a1a;
  }
  .tc-badge {
    font-size: 0.6875rem;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    background: #f0f0f0;
    color: #737373;
    text-decoration: none;
  }
  .tc-badge:hover { background: #e5e5e5; }
  .tc-body { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
`;

// Viewer-specific CSS
const VIEWER_CSS: Record<ViewerType, string> = {
  csv: `
    .tc-table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #e5e5e5; }
    th { background: #f5f5f5; font-weight: 600; color: #525252; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; user-select: none; position: sticky; top: 0; }
    th:hover { background: #eee; }
    tr:hover td { background: #fafafa; }
    .tc-controls { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .tc-search { padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; min-width: 240px; }
    .tc-search:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
    .tc-count { font-size: 0.8125rem; color: #737373; }
    .tc-sort-icon { margin-left: 0.25rem; opacity: 0.4; }
    .tc-sort-icon.active { opacity: 1; color: #4f46e5; }
  `,
  markdown: `
    .tc-prose { max-width: 720px; margin: 0 auto; }
    .tc-prose h1 { font-size: 2rem; font-weight: 700; margin: 2rem 0 1rem; letter-spacing: -0.02em; }
    .tc-prose h2 { font-size: 1.5rem; font-weight: 600; margin: 1.75rem 0 0.75rem; letter-spacing: -0.01em; }
    .tc-prose h3 { font-size: 1.25rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
    .tc-prose p { margin: 0 0 1rem; }
    .tc-prose ul, .tc-prose ol { margin: 0 0 1rem; padding-left: 1.5rem; }
    .tc-prose li { margin: 0.25rem 0; }
    .tc-prose code { background: #f0f0f0; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.875em; }
    .tc-prose pre { background: #1a1a1a; color: #e5e5e5; padding: 1rem 1.25rem; border-radius: 8px; overflow-x: auto; margin: 0 0 1rem; }
    .tc-prose pre code { background: none; padding: 0; font-size: 0.8125rem; line-height: 1.7; }
    .tc-prose blockquote { border-left: 3px solid #4f46e5; padding-left: 1rem; color: #525252; margin: 0 0 1rem; }
    .tc-prose a { color: #4f46e5; text-decoration: none; }
    .tc-prose a:hover { text-decoration: underline; }
    .tc-prose img { max-width: 100%; border-radius: 8px; margin: 1rem 0; }
    .tc-prose table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    .tc-prose th, .tc-prose td { padding: 0.5rem 0.75rem; border: 1px solid #e5e5e5; text-align: left; }
    .tc-prose th { background: #f5f5f5; font-weight: 600; }
    .tc-prose hr { border: none; border-top: 1px solid #e5e5e5; margin: 2rem 0; }
  `,
  json: `
    .tc-json { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.8125rem; line-height: 1.7; }
    .tc-json-key { color: #4f46e5; }
    .tc-json-string { color: #059669; }
    .tc-json-number { color: #d97706; }
    .tc-json-bool { color: #dc2626; }
    .tc-json-null { color: #737373; }
    .tc-json-toggle { cursor: pointer; user-select: none; }
    .tc-json-toggle:hover { background: #f0f0f0; border-radius: 2px; }
    .tc-json-collapsed .tc-json-children { display: none; }
    .tc-json-collapsed .tc-json-preview { display: inline; }
    .tc-json-preview { display: none; color: #a3a3a3; font-style: italic; }
    .tc-json-bracket { color: #525252; }
  `,
  html: "",
  image: `
    .tc-gallery { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); padding: 2rem; }
    .tc-gallery img { max-width: 100%; max-height: calc(100vh - 120px); object-fit: contain; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: zoom-in; }
    .tc-gallery img.zoomed { cursor: zoom-out; max-width: none; max-height: none; }
    .tc-gallery-controls { display: flex; gap: 0.5rem; position: fixed; bottom: 1.5rem; right: 1.5rem; }
    .tc-gallery-btn { padding: 0.5rem 0.75rem; background: #fff; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 0.8125rem; }
    .tc-gallery-btn:hover { background: #f5f5f5; }
  `,
  pdf: `
    .tc-pdf { width: 100%; height: calc(100vh - 60px); }
    .tc-pdf iframe { width: 100%; height: 100%; border: none; }
  `,
  svg: `
    .tc-svg-viewer { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); padding: 2rem; overflow: hidden; }
    .tc-svg-viewer svg { max-width: 100%; max-height: calc(100vh - 120px); }
    .tc-svg-controls { display: flex; gap: 0.5rem; position: fixed; bottom: 1.5rem; right: 1.5rem; }
    .tc-svg-btn { padding: 0.5rem 0.75rem; background: #fff; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 0.8125rem; }
    .tc-svg-btn:hover { background: #f5f5f5; }
  `,
  mermaid: `
    .tc-mermaid { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); padding: 2rem; }
    .tc-mermaid-output { max-width: 100%; overflow: auto; }
  `,
  download: `
    .tc-download { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 60px); text-align: center; }
    .tc-download-card { padding: 3rem; background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; }
    .tc-download-icon { font-size: 3rem; margin-bottom: 1rem; }
    .tc-download-name { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem; }
    .tc-download-meta { font-size: 0.875rem; color: #737373; margin-bottom: 1.5rem; }
    .tc-download-btn { display: inline-block; padding: 0.75rem 1.5rem; background: #4f46e5; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
    .tc-download-btn:hover { background: #4338ca; }
  `,
};

// Viewer-specific client JS
const VIEWER_JS: Record<ViewerType, string> = {
  csv: `
    (function() {
      const raw = document.getElementById('tc-data').textContent;
      const rows = parseCSV(raw);
      if (rows.length === 0) return;
      const headers = rows[0];
      const data = rows.slice(1);
      let sortCol = -1, sortAsc = true;
      let filtered = data;

      const container = document.getElementById('tc-viewer');
      container.innerHTML = '<div class="tc-controls"><input class="tc-search" placeholder="Search..." id="tc-search"><span class="tc-count" id="tc-count"></span></div><div class="tc-table-wrap"><table><thead id="tc-thead"></thead><tbody id="tc-tbody"></tbody></table></div>';

      render();

      document.getElementById('tc-search').addEventListener('input', function(e) {
        const q = e.target.value.toLowerCase();
        filtered = q ? data.filter(r => r.some(c => c.toLowerCase().includes(q))) : data;
        render();
      });

      function render() {
        const thead = document.getElementById('tc-thead');
        thead.innerHTML = '<tr>' + headers.map((h, i) => '<th onclick="window.__tcSort(' + i + ')">' + esc(h) + '<span class="tc-sort-icon' + (sortCol === i ? ' active' : '') + '">' + (sortCol === i ? (sortAsc ? ' ▲' : ' ▼') : ' ⇅') + '</span></th>').join('') + '</tr>';

        const tbody = document.getElementById('tc-tbody');
        const sorted = sortCol >= 0 ? [...filtered].sort((a, b) => {
          const av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
          const an = Number(av), bn = Number(bv);
          if (!isNaN(an) && !isNaN(bn)) return sortAsc ? an - bn : bn - an;
          return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        }) : filtered;

        tbody.innerHTML = sorted.map(r => '<tr>' + headers.map((_, i) => '<td>' + esc(r[i] ?? '') + '</td>').join('') + '</tr>').join('');
        document.getElementById('tc-count').textContent = filtered.length + ' rows';
      }

      window.__tcSort = function(i) {
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
      const raw = document.getElementById('tc-data').textContent;
      const container = document.getElementById('tc-viewer');
      container.innerHTML = '<div class="tc-prose">' + renderMarkdown(raw) + '</div>';

      function renderMarkdown(md) {
        let html = md;
        // Code blocks
        html = html.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
          return '<pre><code class="language-' + (lang||'') + '">' + esc(code.trim()) + '</code></pre>';
        });
        // Inline code
        html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
        // Headers
        html = html.replace(/^######\\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\\s+(.+)$/gm, '<h1>$1</h1>');
        // Bold & italic
        html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        // Links & images
        html = html.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<img src="$2" alt="$1">');
        html = html.replace(/\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
        // Blockquotes
        html = html.replace(/^>\\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');
        // Horizontal rule
        html = html.replace(/^---$/gm, '<hr>');
        // Unordered lists
        html = html.replace(/^[\\-\\*]\\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\\/li>\\n?)+/g, '<ul>$&</ul>');
        // Paragraphs
        html = html.replace(/^(?!<[hupbloai]|<\\/)(\\S[^\\n]+)$/gm, '<p>$1</p>');
        return html;
      }

      function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    })();
  `,
  json: `
    (function() {
      const raw = document.getElementById('tc-data').textContent;
      const container = document.getElementById('tc-viewer');
      try {
        const data = JSON.parse(raw);
        container.innerHTML = '<div class="tc-json">' + renderJson(data, 0) + '</div>';
      } catch(e) {
        container.innerHTML = '<pre style="padding:1rem;color:#dc2626">Invalid JSON: ' + e.message + '</pre>';
      }

      function renderJson(val, depth) {
        if (val === null) return '<span class="tc-json-null">null</span>';
        if (typeof val === 'boolean') return '<span class="tc-json-bool">' + val + '</span>';
        if (typeof val === 'number') return '<span class="tc-json-number">' + val + '</span>';
        if (typeof val === 'string') return '<span class="tc-json-string">"' + esc(val) + '"</span>';
        if (Array.isArray(val)) {
          if (val.length === 0) return '<span class="tc-json-bracket">[]</span>';
          const id = 'n' + Math.random().toString(36).slice(2,8);
          const items = val.map((v, i) => '<div style="padding-left:1.5rem">' + renderJson(v, depth+1) + (i < val.length-1 ? ',' : '') + '</div>').join('');
          return '<span class="tc-json-toggle" onclick="this.parentElement.classList.toggle(\'tc-json-collapsed\')"><span class="tc-json-bracket">[</span></span><span class="tc-json-preview">[' + val.length + ' items]</span><div class="tc-json-children">' + items + '</div><span class="tc-json-bracket">]</span>';
        }
        if (typeof val === 'object') {
          const keys = Object.keys(val);
          if (keys.length === 0) return '<span class="tc-json-bracket">{}</span>';
          const entries = keys.map((k, i) => '<div style="padding-left:1.5rem"><span class="tc-json-key">"' + esc(k) + '"</span>: ' + renderJson(val[k], depth+1) + (i < keys.length-1 ? ',' : '') + '</div>').join('');
          return '<span class="tc-json-toggle" onclick="this.parentElement.classList.toggle(\'tc-json-collapsed\')"><span class="tc-json-bracket">{</span></span><span class="tc-json-preview">{' + keys.length + ' keys}</span><div class="tc-json-children">' + entries + '</div><span class="tc-json-bracket">}</span>';
        }
        return String(val);
      }

      function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    })();
  `,
  html: "",
  image: `
    (function() {
      const data = JSON.parse(document.getElementById('tc-data').textContent);
      const container = document.getElementById('tc-viewer');
      const img = document.createElement('img');
      img.src = data.url;
      img.alt = data.title || 'Image';
      img.addEventListener('click', function() { img.classList.toggle('zoomed'); });
      const wrap = document.createElement('div');
      wrap.className = 'tc-gallery';
      wrap.appendChild(img);
      const controls = document.createElement('div');
      controls.className = 'tc-gallery-controls';
      controls.innerHTML = '<a class="tc-gallery-btn" href="' + data.url + '" download>Download</a>';
      wrap.appendChild(controls);
      container.appendChild(wrap);
    })();
  `,
  pdf: `
    (function() {
      const data = JSON.parse(document.getElementById('tc-data').textContent);
      const container = document.getElementById('tc-viewer');
      container.innerHTML = '<div class="tc-pdf"><iframe src="' + data.url + '#toolbar=1" title="PDF Viewer"></iframe></div>';
    })();
  `,
  svg: `
    (function() {
      const raw = document.getElementById('tc-data').textContent;
      const container = document.getElementById('tc-viewer');
      const wrap = document.createElement('div');
      wrap.className = 'tc-svg-viewer';
      wrap.innerHTML = raw;
      container.appendChild(wrap);
    })();
  `,
  mermaid: `
    (function() {
      const raw = document.getElementById('tc-data').textContent;
      const container = document.getElementById('tc-viewer');
      container.innerHTML = '<div class="tc-mermaid"><div class="tc-mermaid-output" id="tc-mermaid-output"></div></div>';
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
      script.onload = function() {
        mermaid.initialize({ startOnLoad: false, theme: 'default' });
        mermaid.render('tc-mermaid-svg', raw).then(function(result) {
          document.getElementById('tc-mermaid-output').innerHTML = result.svg;
        });
      };
      document.head.appendChild(script);
    })();
  `,
  download: `
    (function() {
      const data = JSON.parse(document.getElementById('tc-data').textContent);
      const container = document.getElementById('tc-viewer');
      const size = data.size < 1024 ? data.size + ' B' : data.size < 1048576 ? (data.size/1024).toFixed(1) + ' KB' : (data.size/1048576).toFixed(1) + ' MB';
      container.innerHTML = '<div class="tc-download"><div class="tc-download-card"><div class="tc-download-icon">📄</div><div class="tc-download-name">' + data.path + '</div><div class="tc-download-meta">' + size + ' · ' + data.contentType + '</div><a class="tc-download-btn" href="' + data.url + '" download>Download</a></div></div>';
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
  <meta property="og:description" content="Shared via tinycloud">
  <meta property="og:url" content="https://${data.slug}.${data.domain}">
  <meta property="og:type" content="website">
  <style>${BASE_CSS}${viewerCss}</style>
</head>
<body>
  <div class="tc-header">
    <h1>${escapeHtml(data.title)}</h1>
    <a class="tc-badge" href="https://${data.domain}">tinycloud</a>
  </div>
  <div class="tc-body">
    <div id="tc-viewer"></div>
  </div>
  <script type="application/json" id="tc-data">${data.dataJson}</script>
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

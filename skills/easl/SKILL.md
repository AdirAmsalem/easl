---
name: easl
description: >-
  Publishes content as shareable web pages via the easl hosting platform.
  Supports CSV, Markdown, JSON, HTML, SVG, Mermaid diagrams, PDFs, and images —
  each rendered with an interactive viewer. Use when the user wants to share,
  publish, or host generated content as a web page, create a shareable URL for
  data analysis results, reports, dashboards, tables, charts, or diagrams,
  or when the user mentions easl.
metadata:
  author: easl
  version: "0.1"
---

# easl

Agent-native hosting: content goes in, shareable URL comes out. easl auto-detects the content type and renders it with the right interactive viewer.

## Content types

### Text (inline or file)

These work with the single-file shorthand (`{content, contentType}`) and MCP `publish_content`:

| Type | Content-Type | Viewer |
|------|-------------|--------|
| CSV | `text/csv` | Sortable, filterable table |
| Markdown | `text/markdown` | Rendered document with syntax highlighting |
| JSON | `application/json` | Collapsible tree explorer |
| HTML | `text/html` | Served as-is (passthrough) |
| SVG | `image/svg+xml` | Rendered graphic |
| Mermaid | `text/x-mermaid` (use `.mmd` extension) | Rendered diagram |

### Binary (file only)

These require MCP `publish_file` / `publish_site`, or the `files[]` API with `"encoding": "base64"`. The single-file shorthand corrupts binary data.

| Type | Content-Type | Viewer |
|------|-------------|--------|
| PDF | `application/pdf` | Embedded viewer |
| Images | `image/png`, `image/jpeg`, `image/gif`, `image/webp` | Image viewer |

For CSV: always include a header row. For multi-file sites with an `index.html`: easl serves the HTML as-is. Without one, easl auto-generates a navigation page.

## When to use easl

Reach for easl whenever generated content needs to be viewable in a browser or shared via URL:
- Data analysis output (CSV tables, JSON results, charts)
- Reports and documentation (Markdown, HTML)
- Diagrams and visuals (Mermaid, SVG, images)
- Multi-file sites (dashboards, static apps)
- Any artifact that benefits from a shareable link with a proper viewer

## Publishing via MCP server

The `@easl/mcp` server provides five tools:

- **`publish_content`** — Publish inline text (text types only). Fastest path: pass `content` and `contentType`, get a URL back.
- **`publish_file`** — Publish a single file from disk by path. Works with any file type including binary (PDF, images).
- **`publish_site`** — Publish an entire directory as a multi-file site. Works with any file types.
- **`list_sites`** — List sites published in this session.
- **`delete_site`** — Delete a site by slug (session sites only).

All publish tools accept optional `title` and `template` parameters.

## Publishing via HTTP API

**Endpoint:** `POST https://api.easl.dev/publish`

### Single-file shorthand (text types only)

```json
{
  "content": "# Hello\n\nThis is a published page.",
  "contentType": "text/markdown",
  "title": "My Page",
  "template": "minimal"
}
```

### Multi-file

```json
{
  "files": [
    {
      "path": "index.html",
      "content": "<h1>Hello</h1>",
      "contentType": "text/html"
    },
    {
      "path": "data.csv",
      "content": "bmFtZSxhZ2UKQWxpY2UsMzAKQm9iLDI1",
      "contentType": "text/csv",
      "encoding": "base64"
    }
  ],
  "title": "My Site"
}
```

### Request fields

| Field | Required | Description |
|-------|----------|-------------|
| `content` | Yes* | Raw content string (text types only — single-file shorthand) |
| `contentType` | Yes* | MIME type of the content |
| `files` | Yes* | Array of `{path, content, contentType, encoding?}`. Use `"encoding": "base64"` for binary files. |
| `title` | No | Page title |
| `template` | No | `minimal`, `report`, or `dashboard` |
| `slug` | No | Custom slug (lowercase alphanumeric + hyphens, 3-48 chars) |

*Provide either `{content, contentType}` or `{files}`.

### Response

```json
{
  "url": "https://calm-river.easl.dev",
  "slug": "calm-river",
  "claimToken": "ct_...",
  "ogImage": "https://calm-river.easl.dev/_easl/og.png",
  "qrCode": "https://calm-river.easl.dev/_easl/qr.svg",
  "embed": "<iframe src=\"https://calm-river.easl.dev?embed=1\" width=\"100%\" height=\"500\" frameborder=\"0\"></iframe>",
  "expiresAt": "2025-01-14T00:00:00.000Z",
  "anonymous": true
}
```

The `claimToken` is needed to delete the site later. The `embed` snippet provides a ready-to-use iframe.

### Delete a site

```
DELETE https://api.easl.dev/sites/{slug}
Header: X-Claim-Token: {claimToken}
```

## Limits

- **50 files** max per site
- **200 MB** total size per site
- **7-day TTL** for anonymous sites
- OG image, QR code, and embeddable iframe are auto-generated for every published site

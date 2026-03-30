<div align="center">

# easl

**Turn agent output into pages worth sharing.**

[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org)

One API call turns a CSV into a sortable table, Markdown into styled prose, JSON into an interactive tree.<br>
No accounts, no config, no deploy pipeline — just content in, shareable page out.

</div>

<br>

```bash
curl -X POST https://api.easl.dev/publish/inline \
  -H "Content-Type: application/json" \
  -d '{"content": "# Hello World\nSome **markdown** here.", "contentType": "text/markdown"}'

# → https://warm-dawn.easl.dev
```

---

## What happens

easl auto-detects your content and renders it with the right interactive viewer:

- **CSV** → sortable table with sticky headers and alternating rows
- **Markdown** → styled prose with headings, code blocks, and tables
- **JSON** → collapsible tree with syntax highlighting
- **Mermaid** → rendered diagram (flowcharts, sequence diagrams, etc.)
- **SVG** → sanitized, zoomable viewer
- **HTML** → served as-is
- **PDF** → embedded viewer
- **Images** → responsive centered viewer

8 formats. Zero config. All auto-detected.

---

## Quick Start

### For AI agents (MCP)

Add to your MCP config (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "easl": {
      "command": "npx",
      "args": ["-y", "@easl/mcp"]
    }
  }
}
```

Then just ask your agent:

> "Publish this CSV as a shareable table"
>
> "Turn this markdown into a beautiful page"

### With curl

```bash
# Publish a CSV as a sortable table
curl -X POST https://api.easl.dev/publish/inline \
  -H "Content-Type: application/json" \
  -d '{"content": "Name,Role\nAlice,Engineer\nBob,Designer", "contentType": "text/csv"}'

# Publish JSON as an interactive tree
curl -X POST https://api.easl.dev/publish/inline \
  -H "Content-Type: application/json" \
  -d '{"content": "{\"users\": [{\"name\": \"Alice\"}, {\"name\": \"Bob\"}]}", "contentType": "application/json"}'
```

---

## Supported Formats

| Format | Extensions | Rendered as |
|--------|-----------|-------------|
| CSV | `.csv` | Sortable table with sticky headers and alternating rows |
| Markdown | `.md` | Styled prose — headings, code blocks, tables, blockquotes |
| JSON | `.json` | Collapsible tree with syntax highlighting and expand/collapse all |
| HTML | `.html` | Served as-is, no wrapping |
| SVG | `.svg` | Sanitized, zoomable viewer (scripts stripped) |
| PDF | `.pdf` | Embedded iframe viewer |
| Mermaid | `.mmd` | Rendered diagram via Mermaid.js (flowcharts, sequence, etc.) |
| Images | `.png` `.jpg` `.gif` `.webp` | Responsive centered viewer |

---

## MCP Server

The MCP server gives AI agents first-class publishing capabilities through the [Model Context Protocol](https://modelcontextprotocol.io).

### Available Tools

| Tool | Description |
|------|-------------|
| `publish_content` | Publish raw content (string) → shareable page. The fastest path. |
| `publish_file` | Publish a single file from disk with auto-detected rendering. |
| `publish_site` | Publish a directory as a multi-page site. |
| `list_sites` | List sites published in the current session. |
| `delete_site` | Delete a published site by slug. |

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `EASL_API_URL` | `https://api.easl.dev` | API base URL (override for self-hosted) |

---

## REST API

Base URL: `https://api.easl.dev`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/publish/inline` | One-call publish — content in, URL out (max 256 KB) |
| `POST` | `/publish` | Multi-file publish — returns presigned upload URLs |
| `POST` | `/finalize/:slug` | Activate a site after uploading files |
| `GET` | `/sites/:slug` | Get site metadata |
| `DELETE` | `/sites/:slug` | Delete a site (requires `X-Claim-Token` header) |

Full API docs: [easl.dev/docs](https://easl.dev/docs)

---

## Architecture

easl runs on Cloudflare's edge network as a single Worker:

- **[Hono](https://hono.dev)** router handles API requests, landing page, docs, and wildcard subdomain serving
- **R2** stores uploaded files with presigned URL uploads
- **D1** (SQLite) tracks site metadata and version history
- **KV** caches rendered HTML shells for fast serving

When a site is requested (e.g. `warm-dawn.easl.dev`), the Worker detects the file type, generates an HTML shell with the right interactive viewer, and embeds the raw data for client-side hydration.

### Monorepo Structure

```
packages/
  worker/        → Cloudflare Worker (Hono routes, smart rendering, serving)
  mcp-server/    → MCP server (stdio transport, 5 tools)
```

---

## Self-Hosting

Prerequisites: [Node.js](https://nodejs.org) ≥ 20, a [Cloudflare](https://cloudflare.com) account, and [wrangler](https://developers.cloudflare.com/workers/wrangler/).

1. **Clone and install**
   ```bash
   git clone https://github.com/AdirAmsalem/easl.git
   cd easl
   pnpm install
   ```

2. **Create Cloudflare resources**
   ```bash
   # Create KV namespace
   wrangler kv namespace create SITES_KV

   # Create R2 bucket
   wrangler r2 bucket create easl-content

   # Create D1 database
   wrangler d1 create easl-db
   ```

3. **Configure** — Update `packages/worker/wrangler.toml` with your resource IDs and domain

4. **Initialize the database**
   ```bash
   cd packages/worker
   pnpm db:migrate
   ```

5. **Deploy**
   ```bash
   # Set secrets
   wrangler secret put R2_ACCESS_KEY_ID
   wrangler secret put R2_SECRET_ACCESS_KEY
   wrangler secret put R2_ACCOUNT_ID

   # Deploy the worker
   pnpm deploy
   ```

---

## Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start local dev server (wrangler dev)
pnpm test             # Run tests
pnpm build            # Build all packages
```

Local dev uses path-based routing instead of subdomains:
- API endpoints: `http://localhost:8787/publish`, `/finalize`, `/sites`
- View sites: `http://localhost:8787/s/:slug`
- Docs: `http://localhost:8787/docs`

---

## Contributing

Contributions are welcome! Whether it's bug fixes, new viewer types, or documentation improvements.

1. Fork the repo
2. Create your branch (`git checkout -b my-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Open a PR

Looking for a place to start? Check out the [good first issues](https://github.com/AdirAmsalem/easl/labels/good%20first%20issue).

---

## License

MIT

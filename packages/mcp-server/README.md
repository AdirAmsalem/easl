<div align="center">

<br>

<img src="https://raw.githubusercontent.com/AdirAmsalem/easl/main/assets/logo-light.svg" alt="easl" width="50%">

<br>

**MCP server — turn agent output into pages worth sharing.**

[![npm](https://img.shields.io/npm/v/@easl/mcp?style=flat-square&color=22c55e)](https://www.npmjs.com/package/@easl/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](https://github.com/AdirAmsalem/easl/blob/main/LICENSE)

</div>

<br>

The easl MCP server gives AI agents first-class publishing capabilities through the [Model Context Protocol](https://modelcontextprotocol.io). One tool call turns Markdown, CSV, JSON, HTML, SVG, or Mermaid into a shareable page — no accounts, no config, no deploy pipeline.

## Quick Start

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

Then ask your agent:

> "Publish this CSV as a shareable table"
>
> "Turn this markdown into a beautiful page"

## Tools

| Tool | Description |
|------|-------------|
| `publish_content` | Publish raw content (string) as a shareable page. The fastest path — content in, URL out. Max 256 KB. |
| `publish_file` | Publish a single file from disk with auto-detected rendering. |
| `publish_site` | Publish a directory as a multi-page site. |
| `list_sites` | List sites published in the current session. |
| `delete_site` | Delete a published site by slug. |
| `create_share_link` | Mint a signed, expiring share link for an account-private easl (owner-only). |

The three publish tools also accept `private` (boolean) and `password` (string). Two independent, stackable privacy gates:

- **Password-protected** — pass a `password` (4-128 chars). Protects the page behind a password prompt. Works anonymously; no account needed and does **not** imply `private`.
- **Account-private** — pass `private: true`. Viewable only by the owning account and its share links. Requires the server to be logged in (`EASL_API_KEY` set); otherwise the publish fails with `401`.
- **Both** — pass `private: true` *and* a `password` (with `EASL_API_KEY` set) to require login **and** the password.

## Supported Formats

| Format | Rendered as |
|--------|-------------|
| CSV | Sortable table with sticky headers |
| Markdown | Styled prose — headings, code blocks, tables |
| JSON | Collapsible tree with syntax highlighting |
| HTML | Served as-is |
| SVG | Sanitized, zoomable viewer |
| PDF | Embedded viewer |
| Mermaid | Rendered diagram (flowcharts, sequence, etc.) |
| Images | Responsive centered viewer |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `EASL_API_URL` | `https://api.easl.dev` | API base URL (override for self-hosted) |
| `EASL_API_KEY` | _(none)_ | Account API key (`easl_…`). When set, sent as `Authorization: Bearer` on publish and site requests. Required for account-private publishing and `create_share_link`. Get one by running `easl login` (or `easl login --device` on a headless/remote machine) and copying it from `~/.config/easl/credentials.json`. |

## Links

- [easl.dev](https://easl.dev) — homepage
- [API docs](https://easl.dev/docs) — REST API reference
- [GitHub](https://github.com/AdirAmsalem/easl) — source, issues, contributing

## License

MIT

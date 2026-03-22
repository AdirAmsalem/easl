# Changelog

All notable changes to tinycloud will be documented in this file.

## [0.1.0.0] - 2026-03-23

### Added
- Cloudflare Worker with Hono routing: API subdomain, root landing, wildcard subdomain serving
- Publish flow: POST /publish (presigned R2 uploads), POST /publish/inline (one-call magic), POST /finalize
- Smart renderer: 8 viewer types (CSV sortable table, Markdown prose, JSON collapsible tree, HTML passthrough, image gallery, PDF iframe, SVG zoomable, Mermaid diagrams)
- D1 schema: sites + versions tables with slug PK and cascade delete
- KV caching for rendered HTML shells with versioned keys
- R2 presigned URL generation via aws4fetch
- MCP server with 5 tools: publish_content, publish_file, publish_site, list_sites, delete_site
- Anonymous-only MVP with 7-day TTL and claim token auth for deletion
- SVG sanitization: strip script tags and event handlers before DOM insertion
- Unit tests for pure functions: slug generation, MIME detection, render mode detection (49 tests)

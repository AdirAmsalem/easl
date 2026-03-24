# Changelog

All notable changes to easl will be documented in this file.

## [0.1.2.0] - 2026-03-24

### Added
- SVG logo assets: favicon, wordmark, and easel-as-A combined mark served from `/public`
- Static asset serving via Cloudflare Workers `[assets]` directive
- Interactive hero demo with tab-switching (CSV/Markdown/JSON) and animated previews
- "Start in seconds" setup section with MCP config and curl examples

### Changed
- Hero redesigned: "One API call. Beautiful URL." with agent conversation UI
- Nav logo switched from styled text to SVG image for brand consistency
- Docs page logo and favicon updated to use static SVG assets
- Background darkened from `#0a0a0a` to `#050505` with refined nav blur
- Wrangler route ordering: most-specific routes first

## [0.1.1.0] - 2026-03-24

### Added
- Localhost dev routing for testing without easl.dev subdomain DNS
- Markdown rendering via marked.js v15 CDN (replaces regex renderer)
- Landing page redesign with before/after demos
- D1 fallback in serveSite() — queries D1 when KV cache misses before returning 404
- 5MB render cap — files >5MB served as raw download instead of smart-rendered
- Shared URL helpers (`lib/url.ts`) extracted from publish routes
- Unit tests for URL helpers (56 total tests)

### Fixed
- JSON viewer broken by escaped quotes in embedded data
- Markdown tables not rendering due to regex limitations
- XSS prevention: `escapeScriptClose()` prevents `</script>` injection in embedded JSON
- Timing-safe claim token comparison to prevent timing attacks
- JSON parse error handling on all 3 API endpoints (publish, inline, finalize)
- Parallelized R2 head checks in finalize and R2 deletes in site deletion

### Removed
- Dead `ANON_MAX_TOTAL_SIZE` constant

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

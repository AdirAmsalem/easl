# TODOS

## P1 — High Priority

### Social assets (OG images + QR codes)
Generate branded OG images (Satori + resvg-wasm from R2) on first social crawler request. Generate QR code SVG at finalize time. Rich previews on Slack/Twitter/iMessage are a core differentiator. OG generation needs validation on Workers Paid plan — Satori + resvg-wasm may have compatibility issues.
- **Effort:** L (human: ~1 week / CC: ~2 hours)
- **Depends on:** Deployed Worker (need to test Satori on actual Workers runtime)
- **Context:** Design doc specifies lazy OG generation on first social crawler request (User-Agent detection). QR codes are pure SVG computation at finalize. Both stored in R2 at deterministic keys (og/{slug}.png, qr/{slug}.svg).

## P2 — Medium Priority

### View counter analytics
KV-based page view counter per slug. Increment on non-bot requests. Return in GET /sites/:slug response and in MCP list_sites.
- **Effort:** M (human: ~4 hours / CC: ~30 min)
- **Depends on:** Nothing
- **Context:** KV increments are eventually consistent (approximate counts). Need bot detection heuristic (User-Agent filter). Most motivating metric for creators.

### Integration tests with miniflare
Test full publish flow (POST /publish → PUT file → POST /finalize → GET rendered page) against miniflare. Covers D1, R2, KV interactions. Catches the integration bugs (D1 constraint errors, R2 missing files, KV cache misses) unit tests can't.
- **Effort:** M (human: ~1 day / CC: ~45 min)
- **Depends on:** Unit tests (in scope for current work)

### ~~Replace regex markdown renderer with marked.js~~ DONE
Replaced with marked.js v15 from CDN. Regex fallback kept for offline/CDN-unavailable.

## P3 — Nice to Have

### Dark mode toggle
Dark/light mode toggle with localStorage persistence across all viewer types. CSS custom properties for theme switching. Toggle button in header.
- **Effort:** S (human: ~2 hours / CC: ~15 min)
- **Depends on:** Nothing

# TODOS

## P1 — High Priority

### ~~Social assets (OG images + QR codes)~~ DONE
Eager generation at publish/finalize time via `ctx.waitUntil()`. OG images (Satori + resvg-wasm), QR codes (uqr). Stored in R2 at `og/{slug}.png` and `qr/{slug}.svg`. Served as static files — no crawler detection needed. OG meta tags + Twitter cards added to HTML shell.

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

### ~~Dark mode toggle~~ DONE
Dark/light mode toggle with localStorage persistence. CSS custom properties for theme switching.

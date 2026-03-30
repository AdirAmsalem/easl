# TODOs

## P2 — Medium Priority

### View counter analytics
KV-based page view counter per slug. Increment on non-bot requests. Return in GET /sites/:slug response and in MCP list_sites.
- **Depends on:** Nothing
- **Context:** KV increments are eventually consistent (approximate counts). Need bot detection heuristic (User-Agent filter). Most motivating metric for creators.

### Integration tests with miniflare
Test full publish flow (POST /publish → PUT file → POST /finalize → GET rendered page) against miniflare. Covers D1, R2, KV interactions. Catches the integration bugs (D1 constraint errors, R2 missing files, KV cache misses) unit tests can't.
- **Depends on:** Unit tests (in scope for current work)

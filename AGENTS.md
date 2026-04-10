# AGENTS.md

Project context and guidelines for AI coding agents working on this repository.

## What is easl?

easl is an agent-native hosting platform that auto-detects content types (CSV, Markdown, JSON, HTML, SVG, PDF, Mermaid, images) and renders them as shareable pages with interactive viewers. One API call in, shareable URL out.

## Commands

```bash
pnpm install          # Install dependencies (requires pnpm 9.15+, Node >=20)
pnpm dev              # Start local dev server (wrangler dev at localhost:8787)
pnpm build            # Build all packages via Turborepo
pnpm test             # Run unit tests (vitest)
pnpm test:e2e         # Run e2e tests (vitest + @cloudflare/vitest-pool-workers)
pnpm typecheck        # TypeScript type checking across all packages

# Run a single test file
npx vitest run packages/worker/src/lib/slug.test.ts

# Worker-specific
cd packages/worker
pnpm db:migrate       # Apply D1 schema (wrangler d1 execute)
pnpm deploy           # Deploy to Cloudflare
```

## Architecture

**Monorepo** managed by pnpm workspaces + Turborepo with three packages:

### `packages/worker` — Cloudflare Worker (Hono)
The main application. A single Worker handles all routing by hostname:
- **`api.easl.dev`** → Hono API routes (`src/api/`)
- **`*.easl.dev`** (wildcard subdomains) → Site serving with smart rendering (`src/serve/handler.ts`)
- **`easl.dev`** (root domain) → Landing page, docs, and path-based fallback routing

Key flow — **publishing**: `POST /publish` → accepts content inline (single-file shorthand) or a files array (multi-file), uploads to R2 via binding, inserts D1 rows, fires off OG image + QR code generation via `waitUntil`.

Key flow — **serving**: Request hits `serveSite` → loads metadata from D1 (site + active version JOIN) → `decideRenderMode` classifies as passthrough/single-file/multi-file → for single files, `smartRender` checks L1 (Cache API) then L2 (KV) cache, or generates an HTML shell with embedded viewer.

Bindings: **R2** (file storage), **D1** (SQLite metadata), **KV** (rendered HTML cache).

Local dev uses path-based routing (`/s/:slug`) instead of subdomains.

### `packages/cli` — CLI (`@easl/cli`)
Published to npm and as standalone binaries (macOS/Linux, arm64/x64) via GitHub releases. Commander-based CLI (`src/cli.ts`) with commands: `publish`, `list`, `get`, `delete`, `open`, `doctor`, `completion`. Bundled to single CJS file via esbuild (`dist/cli.cjs`) for npm, or compiled to a single executable via `bun build --compile` (`scripts/build-binaries.mjs`). Local config at `~/.config/easl/sites.json` tracks published sites and claim tokens.

### `packages/mcp-server` — MCP Server (`@easl/mcp`)
Published to npm. Single-file stdio MCP server (`src/index.ts`) with 5 tools: `publish_content`, `publish_file`, `publish_site`, `list_sites`, `delete_site`. Built with tsdown.

## Key source paths

- `packages/worker/src/index.ts` — Main Worker entry, hostname-based routing
- `packages/worker/src/api/publish.ts` — Publish endpoint
- `packages/worker/src/serve/handler.ts` — Site serving, caching, smart rendering
- `packages/worker/src/render/detect.ts` — Content type → render mode decision
- `packages/worker/src/render/templates/base.ts` — HTML shell generation for viewers
- `packages/worker/src/lib/mime.ts` — MIME detection and viewer type mapping
- `packages/worker/src/types.ts` — Shared TypeScript types (Env bindings, API types, D1 row types)
- `packages/worker/schema.sql` — D1 database schema (sites, versions, feedback tables)
- `packages/cli/src/cli.ts` — CLI entry point, command registration
- `packages/cli/src/commands/publish.ts` — Publish command (file, dir, stdin, inline)
- `packages/cli/src/lib/client.ts` — API client wrapper
- `packages/cli/src/lib/config.ts` — Local config (~/.config/easl/sites.json)

## Testing

**Unit tests** live alongside source files as `*.test.ts`. Worker tests in `packages/worker/src/`, CLI tests in `packages/cli/src/`. Run via `pnpm test`.

**E2E tests**:
- Worker: `packages/worker/src/e2e.test.ts` — runs inside Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers` with real miniflare-backed D1, R2, and KV. Config at `packages/worker/vitest.config.e2e.mts`.
- CLI: `packages/cli/src/e2e.test.ts` — spawns the built CLI binary against real `api.easl.dev`. Config at `packages/cli/vitest.config.e2e.mts`.

Run via `pnpm test:e2e`.

## Conventions

- TypeScript throughout, strict mode, ES2022 target
- No linter/formatter configured — match existing code style
- Structured JSON logging via `console.log(JSON.stringify({ event: "...", ... }))`
- Non-blocking background work via `ctx.waitUntil()` / `c.executionCtx.waitUntil()`
- Hono sub-routers mounted on the main app (one per API domain: publish, sites, feedback)
- Before finalizing a change: run `pnpm build`, `pnpm test`, `pnpm test:e2e`, and `pnpm typecheck` and fix any errors

## References

- [Cloudflare Workers docs index](https://developers.cloudflare.com/workers/llms.txt) — full index of all Workers documentation pages
- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/index.md) — architectural and performance guidance

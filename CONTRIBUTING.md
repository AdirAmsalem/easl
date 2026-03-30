# Contributing to easl

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/AdirAmsalem/easl.git
cd easl
pnpm install
```

Requires [Node.js](https://nodejs.org) >= 20 and [pnpm](https://pnpm.io).

## Running Locally

```bash
pnpm dev      # Starts wrangler dev server at http://localhost:8787
pnpm test     # Run unit tests (vitest)
pnpm build    # Build all packages
pnpm typecheck # TypeScript type checking
```

Local dev uses path-based routing (`/s/:slug`) instead of subdomains.

## Project Structure

```
packages/
  worker/       Cloudflare Worker — API routes, rendering, serving
  mcp-server/   MCP server — stdio transport, 5 tools
```

## Making Changes

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `pnpm typecheck && pnpm build && pnpm test` to verify
4. Open a PR against `main`

## What We're Looking For

- Bug fixes with test coverage
- New viewer/renderer types
- Documentation improvements
- Performance optimizations

Check [open issues](https://github.com/AdirAmsalem/easl/issues) for ideas, especially ones labeled `good first issue`.

## Code Style

- TypeScript throughout
- No explicit style guide enforced — match existing patterns
- Keep functions small and focused
- Add tests for new logic in `packages/worker/src/`

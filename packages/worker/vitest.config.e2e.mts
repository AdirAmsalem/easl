import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

const workerDir = path.dirname(new URL(import.meta.url).pathname);
const ogMock = path.resolve(workerDir, "src/__mocks__/og.ts");

// Stub out OG image generation for e2e: the real src/og.ts imports @resvg/resvg-wasm
// and a .wasm binary that the vitest-pool-workers runtime can't load, which crashes the
// whole suite at import time. A resolveId hook matches the raw "../og" specifier reliably
// (an absolute-path alias does not, because aliases match the import string, not the
// resolved path), so og.ts — and its wasm imports — are never loaded under test.
const stubOgImage = {
  name: "stub-og-image",
  enforce: "pre",
  resolveId(id) {
    if (!id.includes("node_modules") && /(^|\/)og(\.ts)?$/.test(id)) {
      return ogMock;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [
    stubOgImage,
    cloudflareTest({
      main: path.resolve(workerDir, "src/index.ts"),
      wrangler: { configPath: path.resolve(workerDir, "wrangler.toml") },
      // SESSION_SECRET is intentionally absent from wrangler.toml [vars] (see comment there).
      // Inject a test value here so private-site e2e tests have a usable signing key.
      miniflare: { bindings: { SESSION_SECRET: "e2e-test-session-secret-not-for-prod" } },
    }),
  ],
  resolve: {
    alias: {
      // satori is only reached through og.ts (now stubbed), but keep the alias as a guard.
      "satori": path.resolve(workerDir, "src/__mocks__/satori.ts"),
    },
  },
  test: {
    include: [path.resolve(workerDir, "src/**/e2e.test.ts")],
  },
});

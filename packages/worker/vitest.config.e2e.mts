import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

const workerDir = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: path.resolve(workerDir, "src/index.ts"),
      wrangler: { configPath: path.resolve(workerDir, "wrangler.toml") },
    }),
  ],
  resolve: {
    alias: {
      // Stub out OG image generation — satori/yoga/resvg use WASM that
      // can't load in the vitest workers pool runtime.
      [path.resolve(workerDir, "src/og.ts")]: path.resolve(workerDir, "src/__mocks__/og.ts"),
      "satori": path.resolve(workerDir, "src/__mocks__/satori.ts"),
    },
  },
  test: {
    include: [path.resolve(workerDir, "src/**/e2e.test.ts")],
  },
});

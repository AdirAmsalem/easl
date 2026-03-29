import { describe, it, expect, vi } from "vitest";
import { serveSite } from "./handler";
import type { Env, SiteMeta } from "../types";

function makeEnv(kvData: Record<string, unknown> = {}): Env {
  return {
    SITES_KV: {
      get: vi.fn(async (key: string) => kvData[key] ?? null),
      put: vi.fn(),
    } as unknown as KVNamespace,
    CONTENT: {
      get: vi.fn(async () => null),
    } as unknown as R2Bucket,
    DB: {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn(async () => null) })) })),
    } as unknown as D1Database,
    DOMAIN: "easl.dev",
    API_HOST: "api.easl.dev",
    WORKERS_DEV_SUBDOMAIN: "easl",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_ACCOUNT_ID: "",
  };
}

const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

describe("serveSite noindex", () => {
  it("returns robots.txt that disallows all crawlers", async () => {
    const req = new Request("https://my-site.easl.dev/robots.txt");
    const res = await serveSite(req, makeEnv(), "my-site", ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /");
  });

  it("sets X-Robots-Tag header on normal site responses", async () => {
    const meta: SiteMeta = {
      slug: "test",
      currentVersionId: "v1",
      status: "active",
      files: [{ path: "data.csv", size: 100, contentType: "text/csv" }],
      title: "Test",
      template: null,
      expiresAt: null,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };

    const env = makeEnv({ "site:test": meta });
    // Mock R2 to return file content for smart render
    (env.CONTENT.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: async () => "name,age\nAlice,30",
      etag: "abc",
    });

    const req = new Request("https://test.easl.dev/");
    const res = await serveSite(req, env, "test", ctx);

    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("sets X-Robots-Tag on 404 responses", async () => {
    const req = new Request("https://nope.easl.dev/");
    const res = await serveSite(req, makeEnv(), "nope", ctx);

    expect(res.status).toBe(404);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});

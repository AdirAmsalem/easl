import { describe, it, expect, vi, beforeEach } from "vitest";
import { serveSite } from "./handler";
import type { Env, SiteMeta } from "../types";

// Mock Cache API globally
const mockCache = {
  match: vi.fn(async (_req: string) => undefined as Response | undefined),
  put: vi.fn(async (_req: string, _res: Response) => undefined),
};
(globalThis as Record<string, unknown>).caches = { default: mockCache };

/** Create a mock D1 row matching the JOIN query result shape */
function makeD1Row(meta: SiteMeta) {
  return {
    slug: meta.slug,
    title: meta.title,
    template: meta.template,
    expires_at: meta.expiresAt,
    created_at: meta.createdAt,
    version_id: meta.currentVersionId,
    files_json: JSON.stringify(meta.files),
  };
}

function makeEnv(opts: { d1Row?: Record<string, unknown> | null } = {}): Env {
  const d1Row = opts.d1Row ?? null;
  return {
    SITES_KV: {
      get: vi.fn(async () => null),
      put: vi.fn(),
    } as unknown as KVNamespace,
    CONTENT: {
      get: vi.fn(async () => null),
    } as unknown as R2Bucket,
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => d1Row),
        })),
      })),
    } as unknown as D1Database,
    DOMAIN: "easl.dev",
    API_HOST: "api.easl.dev",
    WORKERS_DEV_SUBDOMAIN: "easl",
  };
}

const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

beforeEach(() => {
  mockCache.match.mockReset().mockResolvedValue(undefined);
  mockCache.put.mockReset().mockResolvedValue(undefined);
});

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
    };

    const env = makeEnv({ d1Row: makeD1Row(meta) });
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

describe("serveSite D1-based metadata", () => {
  it("reads metadata from D1 via JOIN query", async () => {
    const meta: SiteMeta = {
      slug: "d1test",
      currentVersionId: "v1",
      status: "active",
      files: [{ path: "readme.md", size: 50, contentType: "text/markdown" }],
      title: "D1 Test",
      template: null,
      expiresAt: null,
      createdAt: "2025-01-01T00:00:00Z",
    };

    const env = makeEnv({ d1Row: makeD1Row(meta) });
    (env.CONTENT.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: async () => "# Hello",
      etag: "abc",
    });

    const req = new Request("https://d1test.easl.dev/");
    const res = await serveSite(req, env, "d1test", ctx);

    expect(res.status).toBe(200);
    // Verify D1 was called with the JOIN query
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("JOIN versions"),
    );
    // Verify KV metadata was NOT read
    expect(env.SITES_KV.get).not.toHaveBeenCalledWith(
      expect.stringContaining("site:"),
      expect.anything(),
    );
  });

  it("returns 404 when D1 has no matching site", async () => {
    const env = makeEnv({ d1Row: null });
    const req = new Request("https://missing.easl.dev/");
    const res = await serveSite(req, env, "missing", ctx);

    expect(res.status).toBe(404);
  });

  it("returns 410 for expired sites", async () => {
    const meta: SiteMeta = {
      slug: "old",
      currentVersionId: "v1",
      status: "active",
      files: [{ path: "data.csv", size: 10, contentType: "text/csv" }],
      title: null,
      template: null,
      expiresAt: "2020-01-01T00:00:00Z", // expired
      createdAt: "2019-12-01T00:00:00Z",
    };

    const env = makeEnv({ d1Row: makeD1Row(meta) });
    const req = new Request("https://old.easl.dev/");
    const res = await serveSite(req, env, "old", ctx);

    expect(res.status).toBe(410);
  });

  it("uses waitUntil for HTML cache writes instead of awaiting", async () => {
    const meta: SiteMeta = {
      slug: "wt",
      currentVersionId: "v1",
      status: "active",
      files: [{ path: "data.csv", size: 100, contentType: "text/csv" }],
      title: "WaitUntil Test",
      template: null,
      expiresAt: null,
      createdAt: "2025-01-01T00:00:00Z",
    };

    const env = makeEnv({ d1Row: makeD1Row(meta) });
    (env.CONTENT.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: async () => "name,age\nAlice,30",
      etag: "abc",
    });

    const mockCtx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

    const req = new Request("https://wt.easl.dev/");
    const res = await serveSite(req, env, "wt", mockCtx);

    expect(res.status).toBe(200);
    // Verify KV put was dispatched via waitUntil, not awaited directly
    expect(mockCtx.waitUntil).toHaveBeenCalled();
    // The KV put should have been passed to waitUntil
    expect(env.SITES_KV.put).toHaveBeenCalledWith(
      expect.stringContaining("html:wt:"),
      expect.any(String),
      expect.objectContaining({ expirationTtl: 14400 }),
    );
  });
});

describe("serveSite Cache API L1", () => {
  it("returns Cache API response and skips KV html lookup on Cache API hit", async () => {
    const meta: SiteMeta = {
      slug: "cached",
      currentVersionId: "v1",
      status: "active",
      files: [{ path: "data.csv", size: 100, contentType: "text/csv" }],
      title: "Cached",
      template: null,
      expiresAt: null,
      createdAt: "2025-01-01T00:00:00Z",
    };

    const env = makeEnv({ d1Row: makeD1Row(meta) });
    const cachedResponse = new Response("<html>cached</html>", {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=14400",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
    mockCache.match.mockResolvedValueOnce(cachedResponse);

    const req = new Request("https://cached.easl.dev/");
    const res = await serveSite(req, env, "cached", ctx);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("<html>cached</html>");
    // Cache API was checked with the version-pinned synthetic URL
    expect(mockCache.match).toHaveBeenCalledWith(
      expect.stringContaining("cache.internal/html:cached:v1:"),
    );
    // KV html lookup was skipped (D1 is still called for metadata)
    expect(env.SITES_KV.get).not.toHaveBeenCalled();
    // R2 was not fetched
    expect(env.CONTENT.get).not.toHaveBeenCalled();
  });

  it("backfills Cache API when KV hits but Cache API misses", async () => {
    const meta: SiteMeta = {
      slug: "backfill",
      currentVersionId: "v1",
      status: "active",
      files: [{ path: "data.csv", size: 100, contentType: "text/csv" }],
      title: "Backfill",
      template: null,
      expiresAt: null,
      createdAt: "2025-01-01T00:00:00Z",
    };

    const env = makeEnv({ d1Row: makeD1Row(meta) });
    (env.SITES_KV.get as ReturnType<typeof vi.fn>).mockResolvedValue("<html>from-kv</html>");

    const mockCtx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const req = new Request("https://backfill.easl.dev/");
    const res = await serveSite(req, env, "backfill", mockCtx);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("<html>from-kv</html>");
    // Cache API should have been backfilled via waitUntil
    expect(mockCtx.waitUntil).toHaveBeenCalled();
    expect(mockCache.put).toHaveBeenCalledWith(
      expect.stringContaining("cache.internal/html:backfill:v1:"),
      expect.any(Response),
    );
  });
});

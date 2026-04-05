import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";
import type { Env } from "./types";

const db = (env as unknown as Env).DB;

// Mirror of schema.sql — single-line for D1 exec compatibility
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sites (slug TEXT PRIMARY KEY, title TEXT, template TEXT, claim_token TEXT NOT NULL, is_anonymous INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT, file_count INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES sites(slug) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'uploading', created_at TEXT NOT NULL DEFAULT (datetime('now')), files_json TEXT NOT NULL)`,
];

beforeAll(async () => {
  for (const stmt of SCHEMA) await db.exec(stmt);
});

async function publish(body: Record<string, unknown>) {
  const res = await SELF.fetch("http://localhost/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json<Record<string, unknown>>() };
}

function serve(path: string) {
  return SELF.fetch(`http://localhost${path}`);
}

describe("single-file: publish → serve → metadata → delete", () => {
  let slug: string;
  let claimToken: string;

  it("publishes markdown and returns slug, claimToken, url", async () => {
    const { res, body } = await publish({
      content: "# Hello World",
      contentType: "text/markdown",
    });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ anonymous: true });
    expect(body.slug).toBeDefined();
    expect(body.claimToken).toBeDefined();
    expect(body.url).toBeDefined();
    slug = body.slug as string;
    claimToken = body.claimToken as string;
  });

  it("serves smart-rendered HTML containing the content", async () => {
    const res = await serve(`/s/${slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("Hello World");
  });

  it("returns metadata with fileCount and versions", async () => {
    const res = await serve(`/sites/${slug}`);
    const body = await res.json<Record<string, unknown>>();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ slug, fileCount: 1 });
    expect((body.versions as unknown[]).length).toBe(1);
  });

  it("deletes with valid claim token, then 404s", async () => {
    const del = await SELF.fetch(`http://localhost/sites/${slug}`, {
      method: "DELETE",
      headers: { "X-Claim-Token": claimToken },
    });
    expect(del.status).toBe(200);

    const after = await serve(`/s/${slug}`);
    expect(after.status).toBe(404);
  });
});

describe("multi-file: passthrough with index.html", () => {
  let slug: string;

  it("publishes and serves index.html as passthrough", async () => {
    const { body } = await publish({
      files: [
        { path: "index.html", content: "<h1>Site</h1>", contentType: "text/html" },
        { path: "style.css", content: "body{color:red}", contentType: "text/css" },
      ],
    });
    slug = body.slug as string;

    const root = await serve(`/s/${slug}`);
    expect(root.status).toBe(200);
    expect(await root.text()).toBe("<h1>Site</h1>");
  });

  it("serves sub-files by path", async () => {
    const res = await serve(`/s/${slug}/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/css");
    expect(await res.text()).toBe("body{color:red}");
  });
});

describe("multi-file: auto-nav when no index.html", () => {
  it("generates a nav page listing all files", async () => {
    const { body } = await publish({
      files: [
        { path: "data.csv", content: "a,b\n1,2", contentType: "text/csv" },
        { path: "notes.md", content: "# Notes", contentType: "text/markdown" },
      ],
    });
    const html = await (await serve(`/s/${body.slug}`)).text();
    expect(html).toContain("data.csv");
    expect(html).toContain("notes.md");
  });
});

describe("base64 binary round-trip", () => {
  // 1x1 red PNG
  const PNG = new Uint8Array([
    137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,
    0,0,0,144,119,83,222,0,0,0,12,73,68,65,84,8,215,99,248,207,192,0,0,
    0,3,0,1,24,216,95,168,0,0,0,0,73,69,78,68,174,66,96,130,
  ]);

  it("uploads base64 PNG and serves identical bytes back", async () => {
    const { body } = await publish({
      files: [{ path: "img.png", content: btoa(String.fromCharCode(...PNG)), contentType: "image/png", encoding: "base64" }],
    });
    const res = await serve(`/s/${body.slug}/img.png`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });
});

describe("custom slugs", () => {
  it("accepts a custom slug", async () => {
    const { res, body } = await publish({ content: "x", contentType: "text/plain", slug: "my-custom-e2e" });
    expect(res.status).toBe(201);
    expect(body.slug).toBe("my-custom-e2e");
  });

  it("rejects duplicate slug with 409", async () => {
    const { res } = await publish({ content: "x", contentType: "text/plain", slug: "my-custom-e2e" });
    expect(res.status).toBe(409);
  });
});

describe("delete auth", () => {
  it("401 without token, 403 with wrong token", async () => {
    const { body } = await publish({ content: "x", contentType: "text/plain" });
    const slug = body.slug as string;

    const noToken = await SELF.fetch(`http://localhost/sites/${slug}`, { method: "DELETE" });
    expect(noToken.status).toBe(401);

    const badToken = await SELF.fetch(`http://localhost/sites/${slug}`, {
      method: "DELETE",
      headers: { "X-Claim-Token": "wrong" },
    });
    expect(badToken.status).toBe(403);
  });
});

it("404 for non-existent site", async () => {
  expect((await serve("/sites/does-not-exist")).status).toBe(404);
});

import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";
import type { Env } from "./types";

const db = (env as unknown as Env).DB;

// Mirror of schema.sql — single-line for D1 exec compatibility
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sites (slug TEXT PRIMARY KEY, title TEXT, template TEXT, claim_token TEXT NOT NULL, is_anonymous INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT, file_count INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0, visibility TEXT NOT NULL DEFAULT 'public', password_hash TEXT, owner_id TEXT)`,
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

describe("private easls", () => {
  it("publishes private and returns auto-generated password", async () => {
    const { res, body } = await publish({
      content: "# Secret",
      contentType: "text/markdown",
      private: true,
    });
    expect(res.status).toBe(201);
    expect(body.visibility).toBe("private");
    expect(typeof body.password).toBe("string");
    expect((body.password as string).length).toBeGreaterThan(8);
    // OG image / QR are not surfaced for private sites
    expect(body.ogImage).toBeUndefined();
    expect(body.qrCode).toBeUndefined();
  });

  it("publishes private with caller-supplied password", async () => {
    const { res, body } = await publish({
      content: "x",
      contentType: "text/plain",
      private: true,
      password: "hunter22",
    });
    expect(res.status).toBe(201);
    expect(body.password).toBe("hunter22");
  });

  it("rejects password without private:true", async () => {
    const { res } = await publish({
      content: "x",
      contentType: "text/plain",
      password: "hunter22",
    });
    expect(res.status).toBe(400);
  });

  it("renders the gate (401) for an unauthenticated viewer", async () => {
    const { body } = await publish({
      content: "secret content",
      contentType: "text/plain",
      private: true,
    });
    const slug = body.slug as string;
    const res = await serve(`/s/${slug}`);
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("This easl is private");
    expect(html).not.toContain("secret content");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("rejects a wrong password and re-renders the gate", async () => {
    const { body } = await publish({
      content: "x",
      contentType: "text/plain",
      private: true,
      password: "right-one",
    });
    const slug = body.slug as string;
    const form = new URLSearchParams({ password: "wrong-one", redirect: `/s/${slug}` });
    const res = await SELF.fetch(`http://localhost/s/${slug}/__unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Incorrect password");
  });

  it("unlocks with the right password, sets cookie, and serves content with it", async () => {
    const { body } = await publish({
      content: "secret content",
      contentType: "text/plain",
      private: true,
      password: "open-sesame",
    });
    const slug = body.slug as string;
    const redirect = `/s/${slug}`;
    const form = new URLSearchParams({ password: "open-sesame", redirect });
    const unlock = await SELF.fetch(`http://localhost/s/${slug}/__unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
    });
    expect(unlock.status).toBe(303);
    const setCookie = unlock.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/easl_pk_/);

    // Extract cookie value to replay on the content request
    const cookieValue = setCookie!.split(";")[0];

    const view = await SELF.fetch(`http://localhost${redirect}`, {
      headers: { Cookie: cookieValue },
    });
    expect(view.status).toBe(200);
    const text = await view.text();
    expect(text).toContain("secret content");
    expect(view.headers.get("Cache-Control")).toContain("private");
    // Sliding refresh: response should include a fresh Set-Cookie
    expect(view.headers.get("Set-Cookie")).toMatch(/easl_pk_/);
  });

  it("lands on the full /s/:slug path after unlock (path-based routing)", async () => {
    const { body } = await publish({
      content: "deep content",
      contentType: "text/plain",
      private: true,
      password: "deep-pass",
    });
    const slug = body.slug as string;
    // Hit a sub-path so the gate captures a non-root redirect
    const gate = await serve(`/s/${slug}/content.txt`);
    expect(gate.status).toBe(401);
    const gateHtml = await gate.text();
    // The hidden redirect field must carry the /s/<slug> prefix, not a bare /content.txt
    expect(gateHtml).toContain(`/s/${slug}/content.txt`);
  });

  it("invalidates existing unlock cookies after password rotation", async () => {
    const { body } = await publish({
      content: "rotate me",
      contentType: "text/plain",
      private: true,
      password: "first-pass",
    });
    const slug = body.slug as string;
    const claim = body.claimToken as string;

    // Unlock with the original password
    const unlock = await SELF.fetch(`http://localhost/s/${slug}/__unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "first-pass", redirect: `/s/${slug}` }).toString(),
      redirect: "manual",
    });
    const cookie = unlock.headers.get("Set-Cookie")!.split(";")[0];
    expect((await SELF.fetch(`http://localhost/s/${slug}`, { headers: { Cookie: cookie } })).status).toBe(200);

    // Rotate the password via the owner endpoint
    const rotate = await SELF.fetch(`http://localhost/sites/${slug}/privacy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Claim-Token": claim },
      body: JSON.stringify({ private: true, password: "second-pass" }),
    });
    expect(rotate.status).toBe(200);

    // The old cookie must no longer unlock the site
    const after = await SELF.fetch(`http://localhost/s/${slug}`, { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });

  it("PATCH /sites/:slug/privacy requires claim token", async () => {
    const { body } = await publish({ content: "x", contentType: "text/plain" });
    const slug = body.slug as string;
    const claim = body.claimToken as string;

    const noToken = await SELF.fetch(`http://localhost/sites/${slug}/privacy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ private: true }),
    });
    expect(noToken.status).toBe(401);

    const ok = await SELF.fetch(`http://localhost/sites/${slug}/privacy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Claim-Token": claim },
      body: JSON.stringify({ private: true }),
    });
    expect(ok.status).toBe(200);
    const data = await ok.json<Record<string, unknown>>();
    expect(data.visibility).toBe("private");
    expect(typeof data.password).toBe("string");

    // The site should now gate
    expect((await serve(`/s/${slug}`)).status).toBe(401);
  });
});

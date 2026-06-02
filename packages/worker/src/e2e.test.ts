import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";
import type { Env } from "./types";
import { shareFingerprint, signShareToken } from "./lib/session";
import { makeAuth, type EaslAuth } from "./auth/index";
import type { EmailSender } from "./auth/email";

const testEnv = env as unknown as Env;
const db = (env as unknown as Env).DB;
// Mirror of the value injected via vitest.config.e2e.mts miniflare.bindings.
const E2E_SESSION_SECRET = "e2e-test-session-secret-not-for-prod";

// Mirror of migrations/ — single-line for D1 exec compatibility
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sites (slug TEXT PRIMARY KEY, title TEXT, template TEXT, claim_token TEXT NOT NULL, is_anonymous INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT, file_count INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0, visibility TEXT NOT NULL DEFAULT 'public', password_hash TEXT, owner_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES sites(slug) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'uploading', created_at TEXT NOT NULL DEFAULT (datetime('now')), files_json TEXT NOT NULL)`,
  // Mirror of migrations/0003_better_auth.sql — better-auth core + api-key tables.
  `CREATE TABLE IF NOT EXISTS "user" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "emailVerified" integer NOT NULL, "image" text, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "session" ("id" text NOT NULL PRIMARY KEY, "expiresAt" date NOT NULL, "token" text NOT NULL UNIQUE, "createdAt" date NOT NULL, "updatedAt" date NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade)`,
  `CREATE TABLE IF NOT EXISTS "account" ("id" text NOT NULL PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "verification" ("id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expiresAt" date NOT NULL, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "apikey" ("id" text NOT NULL PRIMARY KEY, "configId" text NOT NULL, "name" text, "start" text, "referenceId" text NOT NULL, "prefix" text, "key" text NOT NULL, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" date, "enabled" integer, "rateLimitEnabled" integer, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" date, "expiresAt" date, "createdAt" date NOT NULL, "updatedAt" date NOT NULL, "permissions" text, "metadata" text)`,
  `CREATE INDEX IF NOT EXISTS "idx_session_userId" ON "session" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "idx_account_userId" ON "account" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "idx_verification_identifier" ON "verification" ("identifier")`,
  `CREATE INDEX IF NOT EXISTS "idx_apikey_configId" ON "apikey" ("configId")`,
  `CREATE INDEX IF NOT EXISTS "idx_apikey_referenceId" ON "apikey" ("referenceId")`,
  `CREATE INDEX IF NOT EXISTS "idx_apikey_key" ON "apikey" ("key")`,
  // Mirror of migrations/0004_cli_handshake.sql — atomic single-use stores for the
  // `easl login` consent-click handshake (marker nonce + CSRF synchronizer token).
  `CREATE TABLE IF NOT EXISTS "cli_handshake_nonce" ("nonce" text NOT NULL PRIMARY KEY, "expires_at" integer NOT NULL, "created_at" integer NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "cli_csrf_token" ("token" text NOT NULL PRIMARY KEY, "session_id" text NOT NULL, "expires_at" integer NOT NULL, "created_at" integer NOT NULL)`,
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

// v1 password-only mode (now decoupled from the `private` flag in v2). A
// password-protected site is published with `password` ALONE (no `private`):
// visibility stays public, the password gate still applies on serve, and it is
// anonymous-publishable exactly as in v1. The serve-side password-gate behaviour
// (gate page, wrong/right password, sliding cookie, rotation invalidation,
// path-based redirect) is unchanged — only how the site is created is updated.
describe("password-protected easls (v1 password gate, no account)", () => {
  it("publishes a password-protected site with a caller-supplied password (anonymous)", async () => {
    const { res, body } = await publish({
      content: "x",
      contentType: "text/plain",
      password: "hunter22",
    });
    expect(res.status).toBe(201);
    expect(body.password).toBe("hunter22");
    // A password gate is not an account gate — visibility stays public.
    expect(body.visibility).toBe("public");
    expect(body.anonymous).toBe(true);
    // OG image / QR are not surfaced for any gated site.
    expect(body.ogImage).toBeUndefined();
    expect(body.qrCode).toBeUndefined();
  });

  it("rejects a too-short password", async () => {
    const { res } = await publish({
      content: "x",
      contentType: "text/plain",
      password: "ab",
    });
    expect(res.status).toBe(400);
  });

  // Fix A — server-picks-a-password on PUBLISH (v1 regression restored). With
  // `generatePassword: true` and no explicit `password`, the worker mints a strong
  // password, returns the plaintext ONCE, and gates the site on it. Reachable via
  // the PASSWORD path (anonymous, visibility stays public — NOT account-private).
  it("auto-generates a password when generatePassword:true and gates the site (anonymous)", async () => {
    const { res, body } = await publish({
      content: "secret content",
      contentType: "text/markdown",
      generatePassword: true,
    });
    expect(res.status).toBe(201);
    // The generated plaintext is returned once, with the shown-once notice.
    expect(typeof body.password).toBe("string");
    expect((body.password as string).length).toBeGreaterThan(0);
    expect(body.passwordNotice).toBeDefined();
    // Password gate, not an account gate — visibility stays public, anonymous.
    expect(body.visibility).toBe("public");
    expect(body.anonymous).toBe(true);
    // Gated → no OG/QR.
    expect(body.ogImage).toBeUndefined();
    expect(body.qrCode).toBeUndefined();

    const generated = body.password as string;
    const slug = body.slug as string;

    // Without the password the site is gated (401), and the content never leaks.
    const gated = await serve(`/s/${slug}`);
    expect(gated.status).toBe(401);
    const gatedHtml = await gated.text();
    expect(gatedHtml).toContain("This easl is private");
    expect(gatedHtml).not.toContain("secret content");

    // The generated password unlocks the site.
    const redirect = `/s/${slug}`;
    const unlock = await SELF.fetch(`http://localhost/s/${slug}/__unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: generated, redirect }).toString(),
      redirect: "manual",
    });
    expect(unlock.status).toBe(303);
    const cookie = unlock.headers.get("Set-Cookie")!.split(";")[0];
    const view = await SELF.fetch(`http://localhost${redirect}`, { headers: { Cookie: cookie } });
    expect(view.status).toBe(200);
    expect(await view.text()).toContain("secret content");
  });

  it("an explicit password takes precedence over generatePassword:true", async () => {
    const { res, body } = await publish({
      content: "x",
      contentType: "text/plain",
      password: "explicit-wins",
      generatePassword: true,
    });
    expect(res.status).toBe(201);
    // The caller's explicit value is returned verbatim — generate is ignored.
    expect(body.password).toBe("explicit-wins");
  });

  it("renders the gate (401) for a viewer without the password", async () => {
    const { body } = await publish({
      content: "secret content",
      contentType: "text/plain",
      password: "gate-pass",
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
    // Use markdown so the body is inlined into the rendered HTML (text/plain uses the
    // download viewer, which embeds a file reference rather than the raw text).
    const { body } = await publish({
      content: "secret content",
      contentType: "text/markdown",
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

    // Rotate the password via the claim-token PATCH path (sets private + password).
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

  it("PATCH /sites/:slug/privacy (claim-token path) sets a password gate and gates the site", async () => {
    // Claim-token-only PATCH with private:true keeps v1 ergonomics: no account is
    // bound (owner_id stays null), a password is generated, and the site gates on it.
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

    // The site should now gate (password gate — owner_id stays null).
    expect((await serve(`/s/${slug}`)).status).toBe(401);
  });
});

// Account-gate (visibility=private + owner_id) serving. The owner-session path is
// fully exercised in Phase 2b (which mints a real better-auth session); here we
// cover the parts of the two-gate tree that need no session: the anonymous→login
// redirect and the share-token bypass. Sites are inserted directly into D1 so the
// test doesn't depend on the (not-yet-migrated) authenticated publish API.
describe("account-private easls (account gate)", () => {
  // Publish a normal (public) site through the API so its file content is written
  // to R2 *by the worker* (test-side env.CONTENT.put is not visible to SELF), then
  // promote the D1 row to account-private by setting owner_id (+ optional password).
  // This stands in for the not-yet-migrated authenticated-publish API.
  async function seedOwned(
    opts: { ownerId?: string | null; passwordHash?: string | null } = {},
  ): Promise<string> {
    const { body } = await publish({ content: "hello", contentType: "text/markdown" });
    const slug = body.slug as string;
    await db
      .prepare(`UPDATE sites SET visibility = 'private', is_anonymous = 0, owner_id = ?, password_hash = ? WHERE slug = ?`)
      .bind(opts.ownerId ?? "owner-user-1", opts.passwordHash ?? null, slug)
      .run();
    return slug;
  }

  /** Sign a share token bound to the seeded site instance (created_at + owner_id). */
  async function signSeededShareToken(slug: string, ttlMs?: number): Promise<string> {
    const row = await db
      .prepare(`SELECT created_at, owner_id FROM sites WHERE slug = ?`)
      .bind(slug)
      .first<{ created_at: string; owner_id: string | null }>();
    const fp = await shareFingerprint(E2E_SESSION_SECRET, {
      createdAt: row!.created_at,
      ownerId: row!.owner_id,
    });
    const { token } = ttlMs === undefined
      ? await signShareToken(E2E_SESSION_SECRET, slug, fp)
      : await signShareToken(E2E_SESSION_SECRET, slug, fp, ttlMs);
    return token;
  }

  it("redirects an anonymous viewer to /auth/login with a next param (no password prompt)", async () => {
    const slug = await seedOwned();
    const res = await SELF.fetch(`http://localhost/s/${slug}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("/auth/login");
    expect(location).toContain(`next=${encodeURIComponent(`http://localhost/s/${slug}`)}`);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    // The account gate must resolve before the password gate — no password page leaks.
    expect(await res.text()).not.toContain("This easl is private");
  });

  it("serves content for a valid ?share= token", async () => {
    const slug = await seedOwned();
    const token = await signSeededShareToken(slug);
    const res = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.text()).toContain("hello");
  });

  it("rejects an expired share token (falls back to login redirect)", async () => {
    const slug = await seedOwned();
    const token = await signSeededShareToken(slug, -1000);
    const res = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/auth/login");
  });

  it("rejects a share token minted for a different slug", async () => {
    const slug = await seedOwned();
    // signShareToken with a fingerprint for a different (nonexistent) site.
    const fp = await shareFingerprint(E2E_SESSION_SECRET, { createdAt: "2020-01-01T00:00:00Z", ownerId: null });
    const { token } = await signShareToken(E2E_SESSION_SECRET, "some-other-slug", fp);
    const res = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/auth/login");
  });

  it("share token satisfies only the account gate — a stacked password still prompts", async () => {
    // owner-bound AND password-protected: share token clears Gate 1, password gate (Gate 2) remains.
    const slug = await seedOwned({ passwordHash: "$argon2id$placeholder-never-matches" });
    const token = await signSeededShareToken(slug);
    const res = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("This easl is private");
    // The gate form must carry the share token so the recipient's unlock POST
    // re-clears the account gate instead of dead-ending at /auth/login.
    expect(html).toContain(`share=${encodeURIComponent(token)}`);
  });

  // FIX 1 — a share token bound to a now-deleted site instance must NOT survive a
  // delete + re-publish under the same custom slug (the new instance has a different
  // created_at/owner_id, so the fingerprint changes and the old token is rejected).
  it("rejects an old share token after the slug is deleted and re-published (instance fingerprint changes)", async () => {
    const customSlug = "fp-reuse-e2e";
    // Publish + promote to account-private, mint a valid token for this instance.
    const { body: first } = await publish({ content: "hello", contentType: "text/markdown", slug: customSlug });
    expect(first.slug).toBe(customSlug);
    await db
      .prepare(`UPDATE sites SET visibility = 'private', is_anonymous = 0, owner_id = ?, created_at = ? WHERE slug = ?`)
      .bind("fp-owner-A", "2021-01-01T00:00:00Z", customSlug)
      .run();
    const oldToken = await signSeededShareToken(customSlug);
    // The token works for the current instance.
    const ok = await SELF.fetch(`http://localhost/s/${customSlug}?share=${encodeURIComponent(oldToken)}`);
    expect(ok.status).toBe(200);

    // Free the SAME custom slug (an owned site rejects the claim-token DELETE, so we
    // drop the rows directly — equivalent to an owner delete for the purposes of the
    // slug-reuse scenario), then re-publish it as a fresh instance with a different
    // created_at + owner.
    await db.prepare(`DELETE FROM versions WHERE slug = ?`).bind(customSlug).run();
    await db.prepare(`DELETE FROM sites WHERE slug = ?`).bind(customSlug).run();
    const { body: second } = await publish({ content: "hello again", contentType: "text/markdown", slug: customSlug });
    expect(second.slug).toBe(customSlug);
    await db
      .prepare(`UPDATE sites SET visibility = 'private', is_anonymous = 0, owner_id = ?, created_at = ? WHERE slug = ?`)
      .bind("fp-owner-B", "2024-06-06T00:00:00Z", customSlug)
      .run();

    // The OLD token (bound to the prior instance's fingerprint) is rejected → 302 login.
    const stale = await SELF.fetch(`http://localhost/s/${customSlug}?share=${encodeURIComponent(oldToken)}`, {
      redirect: "manual",
    });
    expect(stale.status).toBe(302);
    expect(stale.headers.get("Location")).toContain("/auth/login");

    // A CURRENT token (bound to the new instance) works.
    const freshToken = await signSeededShareToken(customSlug);
    const fresh = await SELF.fetch(`http://localhost/s/${customSlug}?share=${encodeURIComponent(freshToken)}`);
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toContain("hello again");
  });

  // FIX 2 — after a valid ?share= request, the served response sets a path-scoped
  // share cookie so the page's subresources (fetched WITHOUT the query param) keep
  // clearing the account gate instead of bouncing to login.
  it("sets a share cookie so a subresource request without ?share= still passes the account gate", async () => {
    // A multi-file private site WITHOUT an index.html → its files are served at
    // /<path>. The recipient first hits the nav page with ?share=, then the browser
    // fetches a sub-file with no query param — that must succeed via the cookie.
    const { body } = await publish({
      files: [
        { path: "page.html", content: "<h1>shared page</h1>", contentType: "text/html" },
        { path: "style.css", content: "body{color:green}", contentType: "text/css" },
      ],
    });
    const slug = body.slug as string;
    await db
      .prepare(`UPDATE sites SET visibility = 'private', is_anonymous = 0, owner_id = 'subres-owner' WHERE slug = ?`)
      .bind(slug)
      .run();
    const token = await signSeededShareToken(slug);

    // First request carries ?share= → 200 and a Set-Cookie for the share grant.
    const first = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(token)}`);
    expect(first.status).toBe(200);
    const setCookie = first.headers.get("Set-Cookie");
    expect(setCookie).toMatch(/easl_sh_/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const shareCookie = setCookie!.split(";")[0];

    // A subresource request WITHOUT ?share= but WITH the cookie → served (no 302 login).
    const sub = await SELF.fetch(`http://localhost/s/${slug}/style.css`, {
      headers: { Cookie: shareCookie },
      redirect: "manual",
    });
    expect(sub.status).toBe(200);
    expect(sub.headers.get("Content-Type")).toContain("text/css");
    expect(await sub.text()).toBe("body{color:green}");
    // Gated content is never cached.
    expect(sub.headers.get("Cache-Control")).toContain("no-store");
    // ...and suppresses the Referer so a ?share= token can't leak to third parties.
    expect(sub.headers.get("Referrer-Policy")).toBe("no-referrer");

    // Sanity: the SAME subresource WITHOUT the cookie still bounces to login.
    const noCookie = await SELF.fetch(`http://localhost/s/${slug}/style.css`, { redirect: "manual" });
    expect(noCookie.status).toBe(302);
    expect(noCookie.headers.get("Location")).toContain("/auth/login");
  });

  // FIX 2 — the share cookie satisfies the ACCOUNT gate ONLY; it must not bypass a
  // stacked password gate.
  it("share cookie does NOT bypass a password gate on a private+password site", async () => {
    const slug = await seedOwned({ passwordHash: "$argon2id$placeholder-never-matches" });
    const token = await signSeededShareToken(slug);

    // First ?share= request → 401 password gate, but it still mints the share cookie
    // (Gate 1 was cleared by the token).
    const first = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(token)}`);
    expect(first.status).toBe(401);
    const setCookie = first.headers.get("Set-Cookie");
    expect(setCookie).toMatch(/easl_sh_/);
    const shareCookie = setCookie!.split(";")[0];

    // A follow-up request carrying ONLY the share cookie (no password unlock cookie)
    // still hits the password gate — the share cookie cannot bypass Gate 2.
    const sub = await SELF.fetch(`http://localhost/s/${slug}`, {
      headers: { Cookie: shareCookie },
    });
    expect(sub.status).toBe(401);
    const html = await sub.text();
    expect(html).toContain("This easl is private");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2b — owner-bound publish, account-gate serve, share-links, claim.
//
// These drive REAL better-auth credentials: a session cookie minted by completing
// the magic-link flow through the better-auth handler (with an injected recording
// sender — never real email), and a Bearer API key minted off that session. The
// minted credentials are then replayed against the full Worker via SELF.fetch.
// makeAuth and SELF share the same per-file D1 storage, so sessions/keys persisted
// by one resolve in the other.
// ─────────────────────────────────────────────────────────────────────────────

/** Recording mock sender: captures magic-link emails, delivers nothing. */
function recordingSender(): { sent: { text: string }[]; sender: EmailSender } {
  const sent: { text: string }[] = [];
  return { sent, sender: { async send(m) { sent.push({ text: m.text }); } } };
}

/** Drive a full magic-link sign-in and return { cookie, userId } for the email. */
async function signIn(auth: EaslAuth, email: string, sent: { text: string }[]): Promise<{ cookie: string; userId: string }> {
  const before = sent.length;
  const signInRes = await auth.handler(
    new Request("https://api.easl.dev/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  expect(signInRes.status).toBe(200);
  expect(sent.length).toBe(before + 1);
  const urlMatch = sent[sent.length - 1].text.match(/https?:\/\/\S+/);
  const token = new URL(urlMatch![0]).searchParams.get("token")!;

  // Verify WITHOUT a callbackURL → better-auth returns JSON + sets the session cookie
  // (the redirect path leaks an unhandled rejection through the Workers wrapper).
  const verifyRes = await auth.handler(
    new Request(`https://api.easl.dev/auth/magic-link/verify?token=${encodeURIComponent(token)}`),
  );
  expect(verifyRes.status).toBe(200);
  const setCookie = verifyRes.headers.get("set-cookie")!;
  const cookie = setCookie
    .split(/,(?=[^ ;]+=)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");

  // Resolve the user id from the session.
  const sessionRes = await auth.handler(
    new Request("https://api.easl.dev/auth/get-session", { headers: { cookie } }),
  );
  const session = await sessionRes.json<{ user: { id: string } }>();
  return { cookie, userId: session.user.id };
}

/** Mint a Bearer API key for the signed-in user (returns the raw `easl_…` key). */
async function mintApiKey(auth: EaslAuth, cookie: string): Promise<string> {
  const res = await auth.handler(
    new Request("https://api.easl.dev/auth/api-key/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, origin: "https://api.easl.dev" },
      body: JSON.stringify({ name: "e2e" }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json<{ key: string }>()).key;
}

describe("account-private easls (Phase 2b: owner-bound publish + serve + share + claim)", () => {
  it("authenticated publish with private:true binds owner_id; owner views it, non-owner 403s, anon 302s", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "owner-2b@example.com", sent);
    const ownerKey = await mintApiKey(auth, owner.cookie);

    // Publish privately as the owner via Bearer (proves owner_id is set on publish).
    const pub = await SELF.fetch("http://localhost/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify({ content: "# Owned secret", contentType: "text/markdown", private: true }),
    });
    expect(pub.status).toBe(201);
    const pubBody = await pub.json<Record<string, unknown>>();
    expect(pubBody.visibility).toBe("private");
    expect(pubBody.anonymous).toBe(false);
    // No password gate was requested → no password surfaced (account gate only).
    expect(pubBody.password).toBeUndefined();
    const slug = pubBody.slug as string;

    // Owner views via session cookie → 200 with content, never cacheable.
    const ownerView = await SELF.fetch(`http://localhost/s/${slug}`, { headers: { cookie: owner.cookie } });
    expect(ownerView.status).toBe(200);
    expect(ownerView.headers.get("Cache-Control")).toContain("no-store");
    expect(await ownerView.text()).toContain("Owned secret");

    // Owner also views via Bearer API key.
    const ownerBearer = await SELF.fetch(`http://localhost/s/${slug}`, {
      headers: { authorization: `Bearer ${ownerKey}` },
    });
    expect(ownerBearer.status).toBe(200);

    // A different authenticated user → 403 (not your easl), no content leak.
    const other = await signIn(auth, "intruder-2b@example.com", sent);
    const otherView = await SELF.fetch(`http://localhost/s/${slug}`, {
      headers: { cookie: other.cookie },
      redirect: "manual",
    });
    expect(otherView.status).toBe(403);
    const otherHtml = await otherView.text();
    expect(otherHtml).not.toContain("Owned secret");
    expect(otherHtml).not.toContain("This easl is private"); // account gate, not the password page

    // Anonymous → 302 to login.
    const anonView = await SELF.fetch(`http://localhost/s/${slug}`, { redirect: "manual" });
    expect(anonView.status).toBe(302);
    expect(anonView.headers.get("Location")).toContain("/auth/login");

    // GET /sites/:slug metadata must not leak for an account-private site:
    // owner sees it; a non-owner and an anonymous caller get the same 404 as a missing site.
    const ownerMeta = await SELF.fetch(`http://localhost/sites/${slug}`, {
      headers: { authorization: `Bearer ${ownerKey}` },
    });
    expect(ownerMeta.status).toBe(200);
    expect((await ownerMeta.json<Record<string, unknown>>()).visibility).toBe("private");

    const otherMeta = await SELF.fetch(`http://localhost/sites/${slug}`, { headers: { cookie: other.cookie } });
    expect(otherMeta.status).toBe(404);
    expect(await otherMeta.text()).not.toContain("Owned secret");

    const anonMeta = await SELF.fetch(`http://localhost/sites/${slug}`);
    expect(anonMeta.status).toBe(404);
  });

  it("requires auth for private:true (anonymous publish → 401)", async () => {
    const res = await SELF.fetch("http://localhost/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x", contentType: "text/plain", private: true }),
    });
    expect(res.status).toBe(401);
  });

  it("owner mints a share-link via the API that satisfies the account gate", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "share-owner-2b@example.com", sent);
    const ownerKey = await mintApiKey(auth, owner.cookie);

    const pub = await SELF.fetch("http://localhost/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify({ content: "shared markdown", contentType: "text/markdown", private: true }),
    });
    const slug = (await pub.json<{ slug: string }>()).slug;

    // Non-owner cannot mint a share link (403).
    const intruder = await signIn(auth, "share-intruder-2b@example.com", sent);
    const denied = await SELF.fetch(`http://localhost/sites/${slug}/share-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: intruder.cookie },
      body: JSON.stringify({}),
    });
    expect(denied.status).toBe(403);

    // Anonymous cannot mint either (401).
    const anonMint = await SELF.fetch(`http://localhost/sites/${slug}/share-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(anonMint.status).toBe(401);

    // Owner mints a share link.
    const minted = await SELF.fetch(`http://localhost/sites/${slug}/share-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    expect(minted.status).toBe(201);
    const link = await minted.json<{ url: string; token: string; expiresAt: string }>();
    expect(link.token).toBeTruthy();
    expect(link.url).toContain("share=");
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // An anonymous recipient with the share token sees the content (account gate cleared).
    const recipient = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(link.token)}`);
    expect(recipient.status).toBe(200);
    expect(await recipient.text()).toContain("shared markdown");
  });

  it("rejects expiresIn over the 30-day maximum", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "share-max-2b@example.com", sent);
    const ownerKey = await mintApiKey(auth, owner.cookie);
    const pub = await SELF.fetch("http://localhost/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify({ content: "x", contentType: "text/plain", private: true }),
    });
    const slug = (await pub.json<{ slug: string }>()).slug;

    const res = await SELF.fetch(`http://localhost/sites/${slug}/share-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ expiresIn: 31 * 24 * 60 * 60 }),
    });
    expect(res.status).toBe(400);
  });

  it("private + password requires BOTH gates (account first, then password)", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "both-gates-2b@example.com", sent);
    const ownerKey = await mintApiKey(auth, owner.cookie);

    // Stacked: account gate (private) + password gate.
    const pub = await SELF.fetch("http://localhost/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify({
        content: "double secret",
        contentType: "text/markdown",
        private: true,
        password: "stack-pass",
      }),
    });
    expect(pub.status).toBe(201);
    const pubBody = await pub.json<{ slug: string; password: string }>();
    expect(pubBody.password).toBe("stack-pass");
    const slug = pubBody.slug;

    // Owner authenticated but WITHOUT the password → clears Gate 1, stopped at Gate 2.
    const gate2 = await SELF.fetch(`http://localhost/s/${slug}`, { headers: { cookie: owner.cookie } });
    expect(gate2.status).toBe(401);
    const gate2Html = await gate2.text();
    expect(gate2Html).toContain("This easl is private");
    expect(gate2Html).not.toContain("double secret");

    // Anonymous (no account) → 302 to login at Gate 1 (never reaches the password page).
    const anon = await SELF.fetch(`http://localhost/s/${slug}`, { redirect: "manual" });
    expect(anon.status).toBe(302);
    expect(anon.headers.get("Location")).toContain("/auth/login");

    // Owner + correct password unlock → both gates satisfied → content served.
    const unlock = await SELF.fetch(`http://localhost/s/${slug}/__unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: owner.cookie },
      body: new URLSearchParams({ password: "stack-pass", redirect: `/s/${slug}` }).toString(),
      redirect: "manual",
    });
    expect(unlock.status).toBe(303);
    const unlockCookie = unlock.headers.get("Set-Cookie")!.split(";")[0];
    const view = await SELF.fetch(`http://localhost/s/${slug}`, {
      headers: { cookie: `${owner.cookie}; ${unlockCookie}` },
    });
    expect(view.status).toBe(200);
    expect(await view.text()).toContain("double secret");
  });

  it("share recipient can UNLOCK a stacked private+password site (share token carried through the unlock POST)", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "share-unlock-2b@example.com", sent);
    const ownerKey = await mintApiKey(auth, owner.cookie);

    // Stacked: account gate (private) + password gate.
    const pub = await SELF.fetch("http://localhost/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify({
        content: "shared + locked secret",
        contentType: "text/markdown",
        private: true,
        password: "recipient-pass",
      }),
    });
    expect(pub.status).toBe(201);
    const slug = (await pub.json<{ slug: string }>()).slug;

    // Owner mints a share link (clears Gate 1 for the anonymous recipient).
    const minted = await SELF.fetch(`http://localhost/sites/${slug}/share-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    expect(minted.status).toBe(201);
    const token = (await minted.json<{ token: string }>()).token;

    // Anonymous recipient with the share token clears Gate 1 but still hits the
    // password gate (Gate 2). The gate form must carry the share token forward.
    const gate = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(token)}`);
    expect(gate.status).toBe(401);
    const gateHtml = await gate.text();
    expect(gateHtml).toContain("This easl is private");
    // The form action carries the share token so the unlock POST re-clears Gate 1.
    expect(gateHtml).toContain(`share=${encodeURIComponent(token)}`);

    // Recipient submits the password to the unlock endpoint WITH the share token in
    // the query string (no session). This is the flow that previously dead-ended at
    // a /auth/login redirect because the POST carried no share token.
    const unlock = await SELF.fetch(
      `http://localhost/s/${slug}/__unlock?share=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          password: "recipient-pass",
          redirect: `/s/${slug}?share=${token}`,
        }).toString(),
        redirect: "manual",
      },
    );
    expect(unlock.status).toBe(303);
    const setCookie = unlock.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/easl_pk_/);
    // The post-unlock redirect must keep the share token so the next GET clears Gate 1.
    expect(unlock.headers.get("Location")).toContain("share=");
    const unlockCookie = setCookie.split(";")[0];

    // Final GET: share token (Gate 1) + unlock cookie (Gate 2) → content served.
    const view = await SELF.fetch(`http://localhost/s/${slug}?share=${encodeURIComponent(token)}`, {
      headers: { Cookie: unlockCookie },
    });
    expect(view.status).toBe(200);
    expect(await view.text()).toContain("shared + locked secret");
  });

  it("wrong password on a stacked private+password share unlock re-renders the gate (still carries the share token, no login redirect)", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "share-wrongpass-2b@example.com", sent);
    const ownerKey = await mintApiKey(auth, owner.cookie);

    const pub = await SELF.fetch("http://localhost/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify({
        content: "x",
        contentType: "text/markdown",
        private: true,
        password: "the-real-pass",
      }),
    });
    const slug = (await pub.json<{ slug: string }>()).slug;
    const minted = await SELF.fetch(`http://localhost/sites/${slug}/share-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const token = (await minted.json<{ token: string }>()).token;

    // Wrong password + valid share token → 401 gate (not a 302 login redirect), and
    // the re-rendered form still carries the share token for a retry.
    const wrong = await SELF.fetch(
      `http://localhost/s/${slug}/__unlock?share=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: "nope", redirect: `/s/${slug}?share=${token}` }).toString(),
        redirect: "manual",
      },
    );
    expect(wrong.status).toBe(401);
    const wrongHtml = await wrong.text();
    expect(wrongHtml).toContain("Incorrect password");
    expect(wrongHtml).toContain(`share=${encodeURIComponent(token)}`);
  });

  it("claim adopts an anonymous site into an account, then the owner can view it privately", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "claimer-2b@example.com", sent);

    // Publish anonymously (public), capture the claim token.
    const pub = await publish({ content: "# claim me", contentType: "text/markdown" });
    const slug = pub.body.slug as string;
    const claimToken = pub.body.claimToken as string;

    // Wrong claim token → 403.
    const badClaim = await SELF.fetch(`http://localhost/sites/${slug}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ claimToken: "nope" }),
    });
    expect(badClaim.status).toBe(403);

    // Unauthenticated claim → 401.
    const anonClaim = await SELF.fetch(`http://localhost/sites/${slug}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimToken }),
    });
    expect(anonClaim.status).toBe(401);

    // Authenticated claim with the right token → adopts the site.
    const claim = await SELF.fetch(`http://localhost/sites/${slug}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ claimToken }),
    });
    expect(claim.status).toBe(200);
    expect((await claim.json<{ owned: boolean }>()).owned).toBe(true);

    // Now make it account-private via the owner session (no claim token needed).
    const priv = await SELF.fetch(`http://localhost/sites/${slug}/privacy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ private: true }),
    });
    expect(priv.status).toBe(200);

    // The owner can view it; an anonymous visitor is bounced to login (account gate).
    const ownerView = await SELF.fetch(`http://localhost/s/${slug}`, { headers: { cookie: owner.cookie } });
    expect(ownerView.status).toBe(200);
    const anonView = await SELF.fetch(`http://localhost/s/${slug}`, { redirect: "manual" });
    expect(anonView.status).toBe(302);
    expect(anonView.headers.get("Location")).toContain("/auth/login");
  });

  it("revokes the old claim token on claim — it can no longer DELETE or PATCH the owned site", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "revoke-claim-2b@example.com", sent);

    // Publish anonymously and capture the (about-to-be-stale) claim token.
    const pub = await publish({ content: "# revoke me", contentType: "text/markdown" });
    const slug = pub.body.slug as string;
    const staleToken = pub.body.claimToken as string;

    // Adopt the site into the owner's account.
    const claim = await SELF.fetch(`http://localhost/sites/${slug}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ claimToken: staleToken }),
    });
    expect(claim.status).toBe(200);

    // The old claim token must no longer authorize a privacy flip on the owned
    // site (would otherwise let a leaked token rotate the password / reassign owner).
    const patchWithStale = await SELF.fetch(`http://localhost/sites/${slug}/privacy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Claim-Token": staleToken },
      body: JSON.stringify({ private: true }),
    });
    expect(patchWithStale.status).toBe(403);

    // …nor a delete. The site is still there afterwards (owner session deletes it).
    const delWithStale = await SELF.fetch(`http://localhost/sites/${slug}`, {
      method: "DELETE",
      headers: { "X-Claim-Token": staleToken },
    });
    expect(delWithStale.status).toBe(403);

    // The owner session still works — confirming the site was not actually deleted.
    const ownerDel = await SELF.fetch(`http://localhost/sites/${slug}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    });
    expect(ownerDel.status).toBe(200);
  });

  it("DELETE accepts the owner session (no claim token) for an account-owned site", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const owner = await signIn(auth, "deleter-2b@example.com", sent);
    const ownerKey = await mintApiKey(auth, owner.cookie);

    const pub = await SELF.fetch("http://localhost/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify({ content: "delete me", contentType: "text/markdown", private: true }),
    });
    const slug = (await pub.json<{ slug: string }>()).slug;

    // A non-owner session cannot delete (403).
    const intruder = await signIn(auth, "delete-intruder-2b@example.com", sent);
    const denied = await SELF.fetch(`http://localhost/sites/${slug}`, {
      method: "DELETE",
      headers: { cookie: intruder.cookie },
    });
    expect(denied.status).toBe(403);

    // The owner session deletes it.
    const del = await SELF.fetch(`http://localhost/sites/${slug}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    });
    expect(del.status).toBe(200);
    expect((await SELF.fetch(`http://localhost/s/${slug}`, { redirect: "manual" })).status).toBe(404);
  });

  it("GET /sites/:slug surfaces visibility and never the password hash", async () => {
    const { body } = await publish({ content: "x", contentType: "text/plain", password: "peek" });
    const slug = body.slug as string;
    const res = await SELF.fetch(`http://localhost/sites/${slug}`);
    expect(res.status).toBe(200);
    const meta = await res.json<Record<string, unknown>>();
    expect(meta.visibility).toBe("public"); // password gate doesn't change visibility
    expect(meta.password).toBeUndefined();
    expect(meta.password_hash).toBeUndefined();
    expect(meta.passwordHash).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2b review fixes — login page exists, anonymous publish is independent of
// BETTER_AUTH_SECRET, and the session cookie is cross-subdomain.
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /auth/login (the account-gate redirect target must exist)", () => {
  it("returns a 200 HTML sign-in page (not the better-auth /auth/* 404)", async () => {
    const slug = "login-target-e2e";
    const next = `http://localhost/s/${slug}`;
    const res = await SELF.fetch(`http://localhost/auth/login?next=${encodeURIComponent(next)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    // Stable across the generic and private-easl-contextual copy variants (this
    // `next` is a private easl, so the page renders the contextual heading).
    expect(html).toContain("send you a sign-in link");
    // The validated same-origin `next` is embedded so the page can pass it as the
    // magic-link callbackURL.
    expect(html).toContain(next);
  });

  it("falls back to the apex domain for an off-site (open-redirect) next", async () => {
    const res = await SELF.fetch(
      `http://localhost/auth/login?next=${encodeURIComponent("https://evil.example.com/phish")}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("evil.example.com");
  });

  it("is reachable as the account-gate redirect destination end-to-end", async () => {
    // Insert an owned private site directly, hit it anonymously → 302 to /auth/login,
    // then follow that Location and confirm it serves the 200 page (no dead end).
    const { body } = await publish({ content: "x", contentType: "text/markdown" });
    const slug = body.slug as string;
    await db
      .prepare(`UPDATE sites SET visibility = 'private', is_anonymous = 0, owner_id = 'login-flow-owner' WHERE slug = ?`)
      .bind(slug)
      .run();

    const gate = await SELF.fetch(`http://localhost/s/${slug}`, { redirect: "manual" });
    expect(gate.status).toBe(302);
    const location = gate.headers.get("Location")!;
    expect(location).toContain("/auth/login");

    const loginPage = await SELF.fetch(new URL(location, "http://localhost").toString());
    expect(loginPage.status).toBe(200);
    // Stable across both copy variants; the gate `next` points at this private easl,
    // so the page also renders the contextual "This easl is private" heading.
    const loginHtml = await loginPage.text();
    expect(loginHtml).toContain("send you a sign-in link");
    expect(loginHtml).toContain("This easl is private");
  });
});

describe("anonymous publishing + claim-token mutations are independent of BETTER_AUTH_SECRET", () => {
  // We can't unset the suite-wide BETTER_AUTH_SECRET (injected via miniflare.bindings),
  // but the fix's load-bearing property is that a request carrying NO auth credential
  // never constructs better-auth at all (getOptionalUser short-circuits to null before
  // makeAuth). So a bare anonymous publish + claim-token delete, sent with zero auth
  // headers, exercises exactly the path that previously 500'd when the secret was unset.
  it("publishes anonymously and deletes via X-Claim-Token with no auth headers", async () => {
    const pub = await publish({ content: "# no auth needed", contentType: "text/markdown" });
    expect(pub.res.status).toBe(201);
    const slug = pub.body.slug as string;
    const claimToken = pub.body.claimToken as string;

    const del = await SELF.fetch(`http://localhost/sites/${slug}`, {
      method: "DELETE",
      headers: { "X-Claim-Token": claimToken },
    });
    expect(del.status).toBe(200);
    expect((await serve(`/s/${slug}`)).status).toBe(404);
  });
});

describe("better-auth session cookie is scoped to the apex domain (cross-subdomain)", () => {
  // The serve handler's account gate runs on slug.<DOMAIN>, but the magic-link flow
  // completes on api.<DOMAIN> and the login redirect targets <DOMAIN>. A host-only
  // cookie would never reach the slug subdomain. Assert the verify response sets the
  // session cookie with Domain=<DOMAIN> so the browser sends it to every subdomain.
  it("sets Domain=<DOMAIN> on the session cookie from the magic-link verify response", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });

    const signInRes = await auth.handler(
      new Request("https://api.easl.dev/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "xsub-cookie@example.com" }),
      }),
    );
    expect(signInRes.status).toBe(200);
    const token = new URL(sent[sent.length - 1].text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

    const verifyRes = await auth.handler(
      new Request(`https://api.easl.dev/auth/magic-link/verify?token=${encodeURIComponent(token)}`),
    );
    expect(verifyRes.status).toBe(200);
    const setCookie = verifyRes.headers.get("set-cookie")!;
    expect(setCookie).toBeTruthy();
    // env.DOMAIN is "easl.dev" (wrangler.toml [vars]); cookie must be domain-scoped.
    expect(setCookie.toLowerCase()).toContain("domain=easl.dev");
  });
});

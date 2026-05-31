import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../types";
import { makeAuth, AuthSecretUnconfiguredError } from "./index";
import type { EaslAuth } from "./index";
import { getOptionalUser, requireUser } from "./middleware";
import { PLACEHOLDER_BETTER_AUTH_SECRET } from "../lib/session";
import type { EmailSender } from "./email";
import { BETTER_AUTH_SCHEMA } from "./test-schema";

const testEnv = env as unknown as Env;
const db = (env as unknown as Env).DB;

beforeAll(async () => {
  for (const stmt of BETTER_AUTH_SCHEMA) await db.exec(stmt);
});

describe("better-auth boots in the Workers runtime", () => {
  // Proves the factory initializes (D1 dialect, magic-link + api-key plugins) and
  // that the magic-link flow drives an INJECTED sender — never real email delivery.
  it("starts a magic-link sign-in via the injectable sender and persists a verification", async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const mockSender: EmailSender = {
      async send(message) {
        sent.push({ to: message.to, subject: message.subject, text: message.text });
      },
    };

    const auth = makeAuth(env as unknown as Env, { emailSender: mockSender });

    const res = await auth.handler(
      new Request("https://api.easl.dev/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "boot-test@example.com" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ status?: boolean }>();
    expect(body.status).toBe(true);

    // The injected sender received exactly one magic-link email (no CES needed).
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("boot-test@example.com");
    expect(sent[0].text).toContain("/auth/magic-link/verify");

    // better-auth wrote the one-time token to its `verification` table in D1.
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM "verification"`)
      .first<{ n: number }>();
    expect(row!.n).toBeGreaterThan(0);
  });

  it("serves an unauthenticated session as null (no 500 — handler is wired)", async () => {
    const auth = makeAuth(env as unknown as Env);
    const res = await auth.handler(new Request("https://api.easl.dev/auth/get-session"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // No cookie → no session. Confirms the route boots and reads the (empty) session.
    expect(body).toBeNull();
  });

  it("fails closed: makeAuth refuses to boot when BETTER_AUTH_SECRET is unset or a placeholder", () => {
    const base = env as unknown as Env;
    // Unset — better-auth would otherwise silently fall back to its globally-known
    // default secret (validateSecret only throws under NODE_ENV=production, which a
    // Worker never sets), minting forgeable sessions/magic-links/api-keys.
    expect(() => makeAuth({ ...base, BETTER_AUTH_SECRET: undefined })).toThrow(
      AuthSecretUnconfiguredError,
    );
    // The committed .dev.vars placeholder must also be rejected.
    expect(() => makeAuth({ ...base, BETTER_AUTH_SECRET: PLACEHOLDER_BETTER_AUTH_SECRET })).toThrow(
      AuthSecretUnconfiguredError,
    );
    // Too short to be a meaningful key.
    expect(() => makeAuth({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(
      AuthSecretUnconfiguredError,
    );
    // The injected e2e secret is valid, so the configured env boots fine.
    expect(() => makeAuth(base)).not.toThrow();
  });

  it("mounts /auth/* on the Worker so better-auth owns the route", async () => {
    // Exercise the real Worker (path-based routing) end-to-end. With no EMAIL binding
    // configured in the test runtime, the default sender falls back to a console
    // logger — so this hits the full route without delivering real mail.
    const res = await SELF.fetch("http://localhost/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "route-test@example.com" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json<{ status?: boolean }>()).status).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware + full magic-link sign-in + API-key lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/** Recording mock sender: captures magic-link emails, delivers nothing. */
function recordingSender(): { sent: { to: string; text: string }[]; sender: EmailSender } {
  const sent: { to: string; text: string }[] = [];
  return {
    sent,
    sender: {
      async send(message) {
        sent.push({ to: message.to, text: message.text });
      },
    },
  };
}

/** Pull the one-time `token` query param out of a captured magic-link URL. */
function tokenFromEmailText(text: string): string {
  const urlMatch = text.match(/https?:\/\/\S+/);
  expect(urlMatch, "magic-link email should contain a URL").toBeTruthy();
  const token = new URL(urlMatch![0]).searchParams.get("token");
  expect(token, "verify URL should carry a token").toBeTruthy();
  return token!;
}

/**
 * Drive a complete magic-link sign-in against the real better-auth handler and
 * return the session cookie as a replayable `Cookie` header. The entire flow runs
 * through the injected mock sender — no CES, no real email delivery.
 */
async function signInAndGetCookie(
  auth: EaslAuth,
  email: string,
  sent: { text: string }[],
): Promise<string> {
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
  const token = tokenFromEmailText(sent[sent.length - 1].text);

  // Verify WITHOUT a callbackURL: better-auth then returns JSON (and still sets the
  // session cookie) instead of throwing a redirect. The redirect path leaks an
  // unhandled rejection through the Workers transaction wrapper, which vitest fails
  // on; the JSON path exercises the same session creation without that noise.
  const verifyRes = await auth.handler(
    new Request(`https://api.easl.dev/auth/magic-link/verify?token=${encodeURIComponent(token)}`),
  );
  expect(verifyRes.status).toBe(200);
  const setCookie = verifyRes.headers.get("set-cookie");
  expect(setCookie, "verify should set a session cookie").toBeTruthy();
  // Reduce Set-Cookie (possibly multiple, with attributes) to bare name=value pairs.
  return setCookie!
    .split(/,(?=[^ ;]+=)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
}

/**
 * A tiny probe app whose routes exercise the middleware exactly as the real
 * publish/sites routes will in later phases. Driving it via
 * `app.request(url, init, testEnv)` hands the middleware a real request-scoped D1.
 */
function probeApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/whoami", async (c) => c.json({ user: await getOptionalUser(c) }));
  app.get("/protected", async (c) => {
    const auth = await requireUser(c);
    if (!auth.ok) return auth.response;
    return c.json({ id: auth.user.id, email: auth.user.email });
  });
  return app;
}

describe("auth middleware: getOptionalUser / requireUser", () => {
  it("returns null / 401 when no cookie and no API key are present", async () => {
    const app = probeApp();

    const anon = await app.request("http://localhost/whoami", {}, testEnv);
    expect(anon.status).toBe(200);
    expect(await anon.json()).toEqual({ user: null });

    const blocked = await app.request("http://localhost/protected", {}, testEnv);
    expect(blocked.status).toBe(401);
  });

  it("resolves the user from a session cookie (magic-link sign-in end to end)", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const email = "cookie-user@example.com";

    const cookie = await signInAndGetCookie(auth, email, sent);

    const app = probeApp();
    const res = await app.request("http://localhost/protected", { headers: { cookie } }, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; email: string }>();
    expect(body.email).toBe(email);
    expect(body.id).toBeTruthy();
  });

  it("mints, lists, resolves-via-Bearer, and revokes an API key", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const email = "apikey-user@example.com";
    const cookie = await signInAndGetCookie(auth, email, sent);

    // Mint: the full key is returned exactly once, here. The Origin header must
    // match a trusted origin or better-auth's CSRF guard rejects the POST (403).
    const createRes = await auth.handler(
      new Request("https://api.easl.dev/auth/api-key/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie, origin: "https://api.easl.dev" },
        body: JSON.stringify({ name: "cli" }),
      }),
    );
    expect(createRes.status).toBe(200);
    const created = await createRes.json<{ id: string; key: string }>();
    expect(created.id).toBeTruthy();
    expect(created.key).toBeTruthy();
    // Prefixed so it's recognisable as an easl key.
    expect(created.key.startsWith("easl_")).toBe(true);

    // List: returns key metadata (never the secret) for the signed-in user.
    const listRes = await auth.handler(
      new Request("https://api.easl.dev/auth/api-key/list", { headers: { cookie } }),
    );
    expect(listRes.status).toBe(200);
    const listed = await listRes.json<{ apiKeys: Array<{ id: string }> }>();
    expect(Array.isArray(listed.apiKeys)).toBe(true);
    expect(listed.apiKeys.some((k) => k.id === created.id)).toBe(true);

    // Resolve via Bearer: the probe route sees the key's owner through the
    // middleware with NO cookie — auth comes purely from the Authorization header.
    const app = probeApp();
    const bearerRes = await app.request(
      "http://localhost/protected",
      { headers: { authorization: `Bearer ${created.key}` } },
      testEnv,
    );
    expect(bearerRes.status).toBe(200);
    expect((await bearerRes.json<{ email: string }>()).email).toBe(email);

    // Revoke.
    const deleteRes = await auth.handler(
      new Request("https://api.easl.dev/auth/api-key/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie, origin: "https://api.easl.dev" },
        body: JSON.stringify({ keyId: created.id }),
      }),
    );
    expect(deleteRes.status).toBe(200);

    // After revocation the Bearer key no longer resolves a user...
    const afterRevoke = await app.request(
      "http://localhost/whoami",
      { headers: { authorization: `Bearer ${created.key}` } },
      testEnv,
    );
    expect(afterRevoke.status).toBe(200);
    expect(await afterRevoke.json()).toEqual({ user: null });

    // ...and the list no longer contains it.
    const listAfter = await auth.handler(
      new Request("https://api.easl.dev/auth/api-key/list", { headers: { cookie } }),
    );
    const listedAfter = await listAfter.json<{ apiKeys: Array<{ id: string }> }>();
    expect(listedAfter.apiKeys.some((k) => k.id === created.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate-limit protections (magic-link anti-abuse + api-key non-throttling)
// ─────────────────────────────────────────────────────────────────────────────

describe("magic-link rate limiting", () => {
  it("returns 429 once the per-IP magic-link limit (10/hour) is exceeded", async () => {
    // The limiter keys on the client IP (resolved from cf-connecting-ip — the
    // header makeAuth trusts) + path. A fixed, unique IP isolates this test's
    // bucket from the other suites. The bucket is held in the KV-backed
    // customStorage (shared across isolates), not per-isolate memory.
    const { sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const ip = "203.0.113.42"; // TEST-NET-3, distinct from any other test's IP.

    const fire = () =>
      auth.handler(
        new Request("https://api.easl.dev/auth/sign-in/magic-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": ip,
          },
          body: JSON.stringify({ email: "rate-limit@example.com" }),
        }),
      );

    // The magic-link plugin rule allows max 10 in the window; the 11th is blocked.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await fire()).status);

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    const blocked = await fire();
    expect(blocked.status).toBe(429);
    // sanity: the 11th request in the loop was already over the limit.
    expect(statuses[10]).toBe(429);

    // The shared store is doing the counting: the bucket lives in KV under the
    // `rl:` namespace, keyed by `<ip>|<path>` (better-auth's createRateLimitKey
    // separator), and has crossed the cap. Proves the limit is enforced via the
    // cross-isolate KV customStorage, not memory.
    const bucket = await testEnv.SITES_KV.get(`rl:${ip}|/sign-in/magic-link`);
    expect(bucket, "limiter bucket should be persisted in KV").toBeTruthy();
    expect(JSON.parse(bucket!).count).toBeGreaterThanOrEqual(10);
  });

  it("counts magic-link requests in KV so the cap holds across isolates (not per-isolate memory)", async () => {
    // Directly exercise the wiring: a fresh auth instance built on the same env
    // reads the bucket the FIRST instance wrote — which a per-isolate memory Map
    // (better-auth's default `storage: "memory"`) could not guarantee across
    // separate makeAuth calls sharing nothing but env.SITES_KV.
    const { sender } = recordingSender();
    const ip = "198.51.100.77"; // TEST-NET-2, unique to this test.
    const fire = (auth: EaslAuth) =>
      auth.handler(
        new Request("https://api.easl.dev/auth/sign-in/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
          body: JSON.stringify({ email: "cross-isolate@example.com" }),
        }),
      );

    // Exhaust the cap on one instance.
    const first = makeAuth(testEnv, { emailSender: sender });
    for (let i = 0; i < 10; i++) expect((await fire(first)).status).toBe(200);

    // A brand-new instance (no shared in-memory state) still sees the full count
    // because the bucket is in KV — so it blocks immediately.
    const second = makeAuth(testEnv, { emailSender: sender });
    expect((await fire(second)).status).toBe(429);
  });
});

describe("api-key requests are not per-key rate limited", () => {
  it("resolves the same Bearer key well past the plugin's default 10/day cap", async () => {
    // With the api-key plugin's per-key rateLimit disabled in makeAuth, a single
    // key must keep resolving on every Bearer-authenticated request. Without the
    // fix this would 401 (key stops resolving) once the default cap (10/day) is
    // hit, since enableSessionForAPIKeys runs validateApiKey → isRateLimited on
    // every getOptionalUser/requireUser call.
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const email = "heavy-key-user@example.com";
    const cookie = await signInAndGetCookie(auth, email, sent);

    const createRes = await auth.handler(
      new Request("https://api.easl.dev/auth/api-key/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie, origin: "https://api.easl.dev" },
        body: JSON.stringify({ name: "heavy" }),
      }),
    );
    expect(createRes.status).toBe(200);
    const { key } = await createRes.json<{ key: string }>();

    const app = probeApp();
    // 25 > the plugin's default maxRequests (10) — all must succeed as the owner.
    for (let i = 0; i < 25; i++) {
      const res = await app.request(
        "http://localhost/protected",
        { headers: { authorization: `Bearer ${key}` } },
        testEnv,
      );
      expect(res.status, `request ${i + 1} should resolve the key`).toBe(200);
      expect((await res.json<{ email: string }>()).email).toBe(email);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `easl login` browser handshake — GET /auth/cli-callback mints a key + redirects
// to the CLI's loopback. This is the server side the CLI's loopback server waits on.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the login page for a CLI handshake and pull out the worker-signed `cb`
 * marker (+ the relative cli-callback path) it embedded in the callbackURL. This
 * is exactly what better-auth carries through magic-link verify and 302s the
 * browser to — so the test drives the real, worker-issued marker rather than
 * fabricating one.
 */
async function fetchCliCallbackTarget(
  port: number,
  cliState?: string,
): Promise<{ relative: string; cb: string }> {
  const qs = new URLSearchParams({ cli_port: String(port) });
  if (cliState) qs.set("cli_state", cliState);
  const res = await SELF.fetch(`http://localhost/auth/login?${qs.toString()}`);
  expect(res.status).toBe(200);
  const html = await res.text();
  const m = html.match(/data-next="([^"]*\/auth\/cli-callback[^"]*)"/);
  expect(m, "login page should embed a cli-callback callbackURL").toBeTruthy();
  // data-next is HTML-escaped (& → &amp;); unescape to a usable path.
  const relative = m![1].replace(/&amp;/g, "&");
  const cb = new URL(relative, "http://localhost").searchParams.get("cb");
  expect(cb, "callbackURL must carry a worker-signed cb marker").toBeTruthy();
  return { relative, cb: cb! };
}

describe("CLI login handshake: GET /auth/cli-callback", () => {
  it("mints a scoped, expiring api-key and 302s to the loopback with ?key=&id=&email=&state=", async () => {
    // Establish a session the way magic-link verify would, then hit cli-callback
    // through the REAL worker (path-based routing) carrying that cookie — exactly
    // what the browser does after better-auth redirects it to the callbackURL,
    // INCLUDING the worker-signed cb marker the login page issued.
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const email = "cli-handshake@example.com";
    const cookie = await signInAndGetCookie(auth, email, sent);

    const port = 51234;
    const cliState = "cli-state-nonce-abc123XYZ";
    const { relative } = await fetchCliCallbackTarget(port, cliState);
    const res = await SELF.fetch(`http://localhost${relative}`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);

    const location = res.headers.get("location");
    expect(location, "cli-callback should redirect to the loopback").toBeTruthy();
    const loc = new URL(location!);
    // Redirect target is locked to the CLI's loopback on the requested port.
    expect(loc.protocol).toBe("http:");
    expect(loc.hostname).toBe("127.0.0.1");
    expect(loc.port).toBe(String(port));
    expect(loc.pathname).toBe("/callback");

    const key = loc.searchParams.get("key");
    expect(key, "loopback URL must carry the minted key").toBeTruthy();
    expect(key!.startsWith("easl_")).toBe(true);
    expect(loc.searchParams.get("id"), "loopback URL should carry the key id").toBeTruthy();
    expect(loc.searchParams.get("email")).toBe(email);
    // The CLI's state nonce is echoed back so the loopback can bind the response.
    expect(loc.searchParams.get("state")).toBe(cliState);

    // The handed-back key is real: it resolves to the signed-in user via Bearer auth.
    const app = probeApp();
    const whoami = await app.request(
      "http://localhost/protected",
      { headers: { authorization: `Bearer ${key}` } },
      testEnv,
    );
    expect(whoami.status).toBe(200);
    expect((await whoami.json<{ email: string }>()).email).toBe(email);
  });

  it("REJECTS a cross-site GET with no marker even when a valid session cookie rides in (CSRF / key sprawl)", async () => {
    // The headline attack: a logged-in user is lured to
    // api.<DOMAIN>/auth/cli-callback?port=N. The SameSite=Lax session cookie is
    // sent on this top-level cross-site GET, but with NO worker-issued cb marker
    // the request must be refused and NO key minted.
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const cookie = await signInAndGetCookie(auth, "csrf-victim@example.com", sent);

    const res = await SELF.fetch("http://localhost/auth/cli-callback?port=51000", {
      headers: { cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(403);
    // Definitely no loopback redirect carrying a key.
    expect(res.headers.get("location")).toBeNull();
  });

  it("REJECTS a forged/tampered marker (signature or port mismatch)", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const cookie = await signInAndGetCookie(auth, "forge@example.com", sent);

    // A made-up marker value never verifies.
    const forged = await SELF.fetch(
      "http://localhost/auth/cli-callback?port=51001&cb=not.a.real.marker",
      { headers: { cookie }, redirect: "manual" },
    );
    expect(forged.status).toBe(403);

    // A genuine marker minted for one port can't be replayed against another port.
    const { cb } = await fetchCliCallbackTarget(51002);
    const wrongPort = await SELF.fetch(
      `http://localhost/auth/cli-callback?port=51003&cb=${encodeURIComponent(cb)}`,
      { headers: { cookie }, redirect: "manual" },
    );
    expect(wrongPort.status).toBe(403);
  });

  it("REJECTS a replayed (already-used) marker — single use", async () => {
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const cookie = await signInAndGetCookie(auth, "replay@example.com", sent);

    const port = 51004;
    const { relative } = await fetchCliCallbackTarget(port);

    // First redemption succeeds (mints a key, 302 to loopback).
    const first = await SELF.fetch(`http://localhost${relative}`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(first.status).toBe(302);

    // Replaying the very same callbackURL (same nonce) is refused.
    const second = await SELF.fetch(`http://localhost${relative}`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(second.status).toBe(403);
  });

  it("caps + rotates CLI keys: a second handshake revokes the first key (no key sprawl)", async () => {
    // Defense-in-depth against the residual CSRF: since the marker is minted by the
    // UNAUTHENTICATED login page, an attacker can harvest a fresh marker per attempt
    // and trip a mint each time. Capping + rotating the account's `easl-cli` keys to
    // the newest one means the account never accumulates keys — each successful mint
    // revokes the prior CLI key instead of piling up.
    const { sent, sender } = recordingSender();
    const auth = makeAuth(testEnv, { emailSender: sender });
    const email = "rotate-cli@example.com";
    const cookie = await signInAndGetCookie(auth, email, sent);
    const app = probeApp();

    // Complete a handshake and return the minted key from the loopback redirect.
    async function handshake(port: number): Promise<string> {
      const { relative } = await fetchCliCallbackTarget(port);
      const res = await SELF.fetch(`http://localhost${relative}`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      const key = new URL(res.headers.get("location")!).searchParams.get("key");
      expect(key).toBeTruthy();
      return key!;
    }
    const keyResolves = async (key: string): Promise<boolean> => {
      const res = await app.request(
        "http://localhost/whoami",
        { headers: { authorization: `Bearer ${key}` } },
        testEnv,
      );
      const body = await res.json<{ user: { email?: string } | null }>();
      return body.user?.email === email;
    };

    // First login mints key #1, which resolves.
    const key1 = await handshake(51100);
    expect(await keyResolves(key1)).toBe(true);

    // A second login (e.g. an attacker tripping a mint, or a real re-login) mints
    // key #2 and rotates key #1 OUT — only the newest CLI key survives.
    const key2 = await handshake(51101);
    expect(await keyResolves(key2)).toBe(true);
    expect(await keyResolves(key1)).toBe(false);

    // The account holds at most one active `easl-cli` key, regardless of how many
    // handshakes (markers) were tripped.
    const listRes = await auth.handler(
      new Request("https://api.easl.dev/auth/api-key/list", { headers: { cookie } }),
    );
    const listed = await listRes.json<{ apiKeys: Array<{ id: string; name: string | null }> }>();
    expect(listed.apiKeys.filter((k) => k.name === "easl-cli").length).toBe(1);
  });

  it("bounces back to the sign-in page (preserving cli_port + cli_state) when no session is present", async () => {
    const port = 49000;
    const cliState = "no-session-state-0000001";
    const { relative } = await fetchCliCallbackTarget(port, cliState);
    const res = await SELF.fetch(`http://localhost${relative}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    // No loopback redirect without auth — send the user back to sign in, keeping the
    // port + state so a fresh magic link (with a new marker) routes back through.
    expect(location).toContain("/auth/login");
    expect(location).toContain(`cli_port=${port}`);
    expect(location).toContain(`cli_state=${cliState}`);
    expect(location).not.toContain("127.0.0.1");
  });

  it("rejects a missing or out-of-range port with 400 (no redirect)", async () => {
    const missing = await SELF.fetch("http://localhost/auth/cli-callback", { redirect: "manual" });
    expect(missing.status).toBe(400);

    const bad = await SELF.fetch("http://localhost/auth/cli-callback?port=99999", {
      redirect: "manual",
    });
    expect(bad.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The CLI handshake's login page (GET /auth/login?cli_port=<port>) must point the
// magic link's callbackURL at /auth/cli-callback so the post-verify browser routes
// into the key-minting handshake (not the bare account-gate `next`).
// ─────────────────────────────────────────────────────────────────────────────

describe("login page wiring for the CLI handshake", () => {
  it("sets callbackURL to /auth/cli-callback?port=<port>&cb=<marker>&cli_state=<state> when cli_port is present", async () => {
    const port = 52525;
    const cliState = "wiring-state-nonce-12345678";
    const res = await SELF.fetch(
      `http://localhost/auth/login?cli_port=${port}&cli_state=${cliState}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    // The page carries the callbackURL in data-next (HTML-escaped, so & → &amp;),
    // which its JS sends as the magic-link callbackURL — so after verify the
    // browser lands on cli-callback WITH the worker-signed marker + echoed state.
    const m = html.match(/data-next="([^"]*)"/);
    expect(m).toBeTruthy();
    const relative = m![1].replace(/&amp;/g, "&");
    const u = new URL(relative, "http://localhost");
    expect(u.pathname).toBe("/auth/cli-callback");
    expect(u.searchParams.get("port")).toBe(String(port));
    expect(u.searchParams.get("cb"), "must embed a worker-signed marker").toBeTruthy();
    expect(u.searchParams.get("cli_state")).toBe(cliState);
  });

  it("issues a fresh, distinct marker on each login-page load (single-use, not a fixed value)", async () => {
    const port = 52526;
    const a = await fetchCliCallbackTarget(port);
    const b = await fetchCliCallbackTarget(port);
    expect(a.cb).not.toBe(b.cb);
  });

  it("ignores cli_port and falls back to next when cli_port is not a valid port", async () => {
    const res = await SELF.fetch(
      "http://localhost/auth/login?cli_port=notaport&next=" +
        encodeURIComponent("http://localhost/s/my-slug"),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-next="http://localhost/s/my-slug"');
    expect(html).not.toContain("cli-callback");
  });

  it("rate-limits marker minting per IP so an attacker can't harvest unlimited markers (429, no cb)", async () => {
    // The marker is minted by THIS unauthenticated page, so without a cap an
    // attacker could harvest unlimited fresh markers to fuel CSRF attempts against a
    // logged-in victim's cli-callback. The per-IP throttle (allowMarkerMint, max 10)
    // caps the harvest; over the cap the page renders the bare sign-in UI with NO
    // marker and a 429. cf-connecting-ip is the trusted edge header the throttle keys
    // on (a unique IP isolates this test's bucket from the rest of the suite).
    const ip = "203.0.113.99"; // TEST-NET-3, distinct from any other test's IP.
    const port = 53000;
    const fire = () =>
      SELF.fetch(`http://localhost/auth/login?cli_port=${port}`, {
        headers: { "cf-connecting-ip": ip },
      });

    // The first 10 mints succeed and each embeds a worker-signed marker.
    for (let i = 0; i < 10; i++) {
      const res = await fire();
      expect(res.status, `mint ${i + 1} should succeed`).toBe(200);
      expect(await res.text()).toContain("/auth/cli-callback");
    }

    // The 11th is throttled: 429, bare sign-in UI, and crucially NO cb marker.
    const blocked = await fire();
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).not.toContain("cli-callback");
  });
});

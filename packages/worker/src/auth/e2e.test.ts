import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";
import type { Env } from "../types";
import { makeAuth, AuthSecretUnconfiguredError } from "./index";
import { PLACEHOLDER_BETTER_AUTH_SECRET } from "../lib/session";
import type { EmailSender } from "./email";

// better-auth's tables live in the same D1 as sites/versions. The main e2e suite
// (src/e2e.test.ts) bootstraps the full schema in its own beforeAll, but vitest
// isolates storage per test file, so re-create the better-auth tables here.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "user" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "emailVerified" integer NOT NULL, "image" text, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "session" ("id" text NOT NULL PRIMARY KEY, "expiresAt" date NOT NULL, "token" text NOT NULL UNIQUE, "createdAt" date NOT NULL, "updatedAt" date NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade)`,
  `CREATE TABLE IF NOT EXISTS "account" ("id" text NOT NULL PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "verification" ("id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expiresAt" date NOT NULL, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "apikey" ("id" text NOT NULL PRIMARY KEY, "configId" text NOT NULL, "name" text, "start" text, "referenceId" text NOT NULL, "prefix" text, "key" text NOT NULL, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" date, "enabled" integer, "rateLimitEnabled" integer, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" date, "expiresAt" date, "createdAt" date NOT NULL, "updatedAt" date NOT NULL, "permissions" text, "metadata" text)`,
];

const db = (env as unknown as Env).DB;

beforeAll(async () => {
  for (const stmt of SCHEMA) await db.exec(stmt);
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

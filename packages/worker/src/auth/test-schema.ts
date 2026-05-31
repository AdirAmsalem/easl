/**
 * better-auth's tables (user/session/account/verification/apikey) live in the
 * same D1 as sites/versions. The main e2e suite (src/e2e.test.ts) bootstraps the
 * full app schema in its own beforeAll, but @cloudflare/vitest-pool-workers
 * isolates storage per test FILE — so each auth test file must re-create these
 * tables itself. This mirrors migrations/0003_better_auth.sql.
 *
 * Test-only: never imported by the Worker runtime.
 */
export const BETTER_AUTH_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "user" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "emailVerified" integer NOT NULL, "image" text, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "session" ("id" text NOT NULL PRIMARY KEY, "expiresAt" date NOT NULL, "token" text NOT NULL UNIQUE, "createdAt" date NOT NULL, "updatedAt" date NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade)`,
  `CREATE TABLE IF NOT EXISTS "account" ("id" text NOT NULL PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "verification" ("id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expiresAt" date NOT NULL, "createdAt" date NOT NULL, "updatedAt" date NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "apikey" ("id" text NOT NULL PRIMARY KEY, "configId" text NOT NULL, "name" text, "start" text, "referenceId" text NOT NULL, "prefix" text, "key" text NOT NULL, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" date, "enabled" integer, "rateLimitEnabled" integer, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" date, "expiresAt" date, "createdAt" date NOT NULL, "updatedAt" date NOT NULL, "permissions" text, "metadata" text)`,
  // Mirror of migrations/0004_cli_handshake.sql — atomic single-use stores for the
  // `easl login` consent-click handshake (marker nonce + CSRF synchronizer token).
  `CREATE TABLE IF NOT EXISTS "cli_handshake_nonce" ("nonce" text NOT NULL PRIMARY KEY, "expires_at" integer NOT NULL, "created_at" integer NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "cli_csrf_token" ("token" text NOT NULL PRIMARY KEY, "session_id" text NOT NULL, "expires_at" integer NOT NULL, "created_at" integer NOT NULL)`,
];

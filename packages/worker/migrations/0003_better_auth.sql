-- 0003_better_auth
-- better-auth core tables (user, session, account, verification) plus the
-- api-key plugin table (apikey) for account-bound private easls (v2).
--
-- Generated from better-auth 1.6.13's own schema model (`getSchema` with the
-- magic-link + api-key plugins) and emitted in better-auth's kysely sqlite
-- DDL style (quoted identifiers, `date` column type). No naming conflicts with
-- the existing sites / versions / feedback tables. Applied (and tracked) by
-- `wrangler d1 migrations apply`.

CREATE TABLE "user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" integer NOT NULL,
  "image" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);

CREATE TABLE "session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" date NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade
);

CREATE TABLE "account" (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);

CREATE TABLE "verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" date NOT NULL,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);

CREATE TABLE "apikey" (
  "id" text NOT NULL PRIMARY KEY,
  "configId" text NOT NULL,
  "name" text,
  "start" text,
  "referenceId" text NOT NULL,
  "prefix" text,
  "key" text NOT NULL,
  "refillInterval" integer,
  "refillAmount" integer,
  "lastRefillAt" date,
  "enabled" integer,
  "rateLimitEnabled" integer,
  "rateLimitTimeWindow" integer,
  "rateLimitMax" integer,
  "requestCount" integer,
  "remaining" integer,
  "lastRequest" date,
  "expiresAt" date,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "permissions" text,
  "metadata" text
);

CREATE INDEX "idx_session_userId" ON "session" ("userId");
CREATE INDEX "idx_account_userId" ON "account" ("userId");
CREATE INDEX "idx_verification_identifier" ON "verification" ("identifier");
CREATE INDEX "idx_apikey_configId" ON "apikey" ("configId");
CREATE INDEX "idx_apikey_referenceId" ON "apikey" ("referenceId");
CREATE INDEX "idx_apikey_key" ON "apikey" ("key");

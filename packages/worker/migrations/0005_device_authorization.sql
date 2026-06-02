-- 0005_device_authorization
-- Storage for the OAuth 2.0 Device Authorization Grant (RFC 8628) that powers
-- `easl login --device` (headless/remote login: the CLI polls, no loopback).
--
-- Mirrors better-auth's `deviceAuthorization` plugin schema (model `deviceCode`)
-- in the same kysely sqlite DDL style as 0003 (quoted identifiers, `date`
-- columns). The plugin creates a row on /device/code, claims it to the signed-in
-- user on GET /device, flips status on /device/approve|/device/deny, and DELETEs
-- it once the CLI exchanges it on /device/token (or when it expires) — so this
-- table only ever holds short-lived, in-flight handshakes.
--
-- Columns match the plugin's field set exactly (no createdAt/updatedAt — the
-- plugin's schema does not define them, so the adapter never writes them).

CREATE TABLE "deviceCode" (
  "id" text NOT NULL PRIMARY KEY,
  "deviceCode" text NOT NULL UNIQUE,
  "userCode" text NOT NULL,
  "userId" text REFERENCES "user" ("id") ON DELETE cascade,
  "expiresAt" date NOT NULL,
  "status" text NOT NULL,
  "lastPolledAt" date,
  "pollingInterval" integer,
  "clientId" text,
  "scope" text
);

-- GET /device + /device/approve + /device/deny look the row up by userCode.
CREATE INDEX "idx_deviceCode_userCode" ON "deviceCode" ("userCode");

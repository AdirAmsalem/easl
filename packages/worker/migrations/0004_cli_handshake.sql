-- 0004_cli_handshake
-- Atomic single-use storage for the `easl login` browser handshake
-- (GET consent page → POST authorize → loopback key mint).
--
-- Two concerns, both requiring ATOMIC single-use semantics that KV's
-- check-then-put cannot provide (KV has no compare-and-set):
--
--   cli_handshake_nonce  — the worker-signed `cb` marker's embedded nonce.
--     The POST that mints the key INSERTs the nonce; a UNIQUE-violation means
--     the marker was already redeemed (a replay), so the mint is refused. This
--     replaces the prior non-atomic KV check-then-put in cli-callback.ts.
--
--   cli_csrf_token       — the synchronizer (CSRF) token issued when the consent
--     page is rendered, bound to the signed-in session. The authorize POST must
--     present a token that (a) still exists here (INSERT-on-render, DELETE-on-use
--     → single-use, atomic) and (b) matches the SameSite=Strict double-submit
--     cookie. A cross-site attacker can neither read the synchronizer token (it
--     is embedded in a same-origin page the SOP hides) nor set the Strict cookie,
--     so it cannot forge the POST.
--
-- Both tables key on the token text (PRIMARY KEY = UNIQUE) and carry an absolute
-- `expires_at` (epoch ms) so a sweep can drop stale rows; rows are also deleted
-- on successful use. KV TTL remains as best-effort secondary cleanup for the
-- nonce, but D1 uniqueness is the authority for single-use.

CREATE TABLE "cli_handshake_nonce" (
  "nonce" text NOT NULL PRIMARY KEY,
  "expires_at" integer NOT NULL,
  "created_at" integer NOT NULL
);

CREATE TABLE "cli_csrf_token" (
  "token" text NOT NULL PRIMARY KEY,
  "session_id" text NOT NULL,
  "expires_at" integer NOT NULL,
  "created_at" integer NOT NULL
);

CREATE INDEX "idx_cli_handshake_nonce_expires" ON "cli_handshake_nonce" ("expires_at");
CREATE INDEX "idx_cli_csrf_token_expires" ON "cli_csrf_token" ("expires_at");

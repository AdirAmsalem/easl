-- easl D1 database schema
-- Run: wrangler d1 execute easl-db --file=./schema.sql

-- Sites (publishes)
CREATE TABLE IF NOT EXISTS sites (
  slug          TEXT PRIMARY KEY,
  title         TEXT,
  template      TEXT,                -- null = auto-detect
  claim_token   TEXT NOT NULL,       -- random 128-bit hex, plaintext for MVP
  is_anonymous  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT,                -- null = permanent (post-MVP authenticated)
  file_count    INTEGER NOT NULL DEFAULT 0,
  total_bytes   INTEGER NOT NULL DEFAULT 0,
  visibility    TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'private'
  password_hash TEXT,                -- PBKDF2 hash for private sites; null for public
  owner_id      TEXT                 -- reserved for future account-bound ownership; null = anonymous
);

CREATE INDEX IF NOT EXISTS idx_sites_expires ON sites(expires_at);
CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility);

-- Versions (deploy history)
CREATE TABLE IF NOT EXISTS versions (
  id         TEXT PRIMARY KEY,      -- ULID
  slug       TEXT NOT NULL REFERENCES sites(slug) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'uploading',  -- uploading | active | rolled_back
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  files_json TEXT NOT NULL          -- JSON array of { path, contentType, size, r2Key }
);

CREATE INDEX IF NOT EXISTS idx_versions_slug ON versions(slug);

-- Feedback
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  message    TEXT NOT NULL,
  email      TEXT,
  name       TEXT,
  metadata   TEXT,                -- optional JSON blob for agent-specific context
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

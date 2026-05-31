-- 0001_private_sites
-- Adds visibility/password/owner columns for private easls.
-- Apply once to existing databases. Fresh databases get these via schema.sql.
--
-- Run: wrangler d1 execute easl-db --file=./migrations/0001_private_sites.sql
-- For remote (prod): add --remote

ALTER TABLE sites ADD COLUMN visibility    TEXT NOT NULL DEFAULT 'public';
ALTER TABLE sites ADD COLUMN password_hash TEXT;
ALTER TABLE sites ADD COLUMN owner_id      TEXT;

CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility);

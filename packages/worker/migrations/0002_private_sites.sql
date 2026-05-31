-- 0002_private_sites
-- Adds visibility/password/owner columns for private easls.
-- Applied (and tracked) by `wrangler d1 migrations apply`.

ALTER TABLE sites ADD COLUMN visibility    TEXT NOT NULL DEFAULT 'public';
ALTER TABLE sites ADD COLUMN password_hash TEXT;
ALTER TABLE sites ADD COLUMN owner_id      TEXT;

CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility);

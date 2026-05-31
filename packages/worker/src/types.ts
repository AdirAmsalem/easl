// Cloudflare Worker Environment Bindings
export interface Env {
  SITES_KV: KVNamespace;
  CONTENT: R2Bucket;
  DB: D1Database;
  DOMAIN: string;
  API_HOST: string;
  WORKERS_DEV_SUBDOMAIN: string;
  SESSION_SECRET: string;
  // ── Accounts (private easls v2) ──────────────────────────────────────────
  // Cloudflare Email Service binding for magic-link delivery. Configured via the
  // `[[send_email]]` binding in wrangler.toml (requires Workers Paid). Optional so
  // the Worker still boots locally / in tests without an email binding wired up.
  EMAIL?: SendEmail;
  // Signing secret for better-auth sessions, magic-link tokens, and API keys.
  // Like SESSION_SECRET, it is intentionally NOT committed to wrangler.toml [vars];
  // set it as a wrangler secret in prod and via .dev.vars locally.
  BETTER_AUTH_SECRET?: string;
  // Optional override for the auth base URL (default https://api.<DOMAIN>).
  BETTER_AUTH_URL?: string;
}

export type Visibility = "public" | "private";

export interface FileEntry {
  path: string;
  size: number;
  contentType: string;
}

export interface SiteMeta {
  slug: string;
  currentVersionId: string;
  status: "pending" | "active";
  files: FileEntry[];
  title: string | null;
  template: string | null;
  expiresAt: string | null;
  createdAt: string;
  visibility: Visibility;
  passwordHash: string | null;
  // Account that owns the site (set at authenticated publish or via claim). Null
  // for anonymous sites. The serve handler's account gate compares this against
  // the resolved session user's id.
  ownerId: string | null;
}

// D1 row types
export interface SiteRow {
  slug: string;
  title: string | null;
  template: string | null;
  claim_token: string;
  is_anonymous: number;
  created_at: string;
  expires_at: string | null;
  file_count: number;
  total_bytes: number;
  visibility: Visibility;
  password_hash: string | null;
  owner_id: string | null;
}

export interface VersionRow {
  id: string;
  slug: string;
  status: string;
  created_at: string;
  files_json: string;
}

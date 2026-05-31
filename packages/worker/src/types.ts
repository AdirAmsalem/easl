// Cloudflare Worker Environment Bindings
export interface Env {
  SITES_KV: KVNamespace;
  CONTENT: R2Bucket;
  DB: D1Database;
  DOMAIN: string;
  API_HOST: string;
  WORKERS_DEV_SUBDOMAIN: string;
  SESSION_SECRET: string;
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

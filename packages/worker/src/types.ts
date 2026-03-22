// Cloudflare Worker Environment Bindings
export interface Env {
  SITES_KV: KVNamespace;
  CONTENT: R2Bucket;
  DB: D1Database;
  DOMAIN: string;
  API_HOST: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
}

// API request/response types
export interface FileEntry {
  path: string;
  size: number;
  contentType: string;
}

export interface CreateSiteRequest {
  files: FileEntry[];
  title?: string;
  template?: string;
  ttl?: number;
  slug?: string;
}

export interface InlinePublishRequest {
  content: string;
  contentType: string;
  title?: string;
  template?: string;
}

export interface UploadInfo {
  path: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
}

export interface CreateSiteResponse {
  slug: string;
  url: string;
  claimToken: string;
  upload: {
    versionId: string;
    uploads: UploadInfo[];
    finalizeUrl: string;
    expiresInSeconds: number;
  };
  expiresAt: string;
  anonymous: true;
}

export interface FinalizeResponse {
  url: string;
  slug: string;
  ogImage: null;
  qrCode: string;
  embed: string;
  shareText: string;
}

// KV stored metadata
export interface SiteMeta {
  slug: string;
  currentVersionId: string;
  status: "pending" | "active";
  files: FileEntry[];
  title: string | null;
  template: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
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
}

export interface VersionRow {
  id: string;
  slug: string;
  status: string;
  created_at: string;
  files_json: string;
}

import { resolveApiKey } from './credentials';
import { PACKAGE_NAME, VERSION } from './version';

export type GlobalOpts = {
  json?: boolean;
  quiet?: boolean;
  apiUrl?: string;
  /** `--api-key` flag — highest-precedence tier of the auth resolver. */
  apiKey?: string;
};

export function getApiUrl(flagValue?: string): string {
  const url =
    flagValue ??
    process.env.EASL_API_URL ??
    'https://api.easl.dev';
  return url.replace(/\/$/, '');
}

/**
 * Derive the web origin (where the sign-in page lives) from the API URL.
 *
 * The API lives at `api.<DOMAIN>` and the magic-link sign-in page at
 * `<DOMAIN>/auth/login` (see the worker's buildLoginRedirect). We strip a leading
 * `api.` host label to map one to the other. For local/path-based setups
 * (`localhost:8787`, workers.dev previews) there is no `api.` label, so the origin
 * is returned unchanged and `/auth/login` resolves on the same host.
 */
export function getWebUrl(flagValue?: string): string {
  const api = getApiUrl(flagValue);
  try {
    const u = new URL(api);
    if (u.hostname.startsWith('api.')) {
      u.hostname = u.hostname.slice('api.'.length);
    }
    return u.origin;
  } catch {
    return api;
  }
}

export async function apiRequest<T>(
  method: string,
  path: string,
  opts: GlobalOpts,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const baseUrl = getApiUrl(opts.apiUrl);
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
  const headers = new Headers();
  headers.set('User-Agent', `${PACKAGE_NAME}/${VERSION}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  // Three-tier API-key resolution (--api-key → EASL_API_KEY → credentials file).
  // When a key resolves, attach it as `Authorization: Bearer easl_<key>` so the
  // worker's api-key plugin can bind the request to the caller's account. The
  // header is set BEFORE extraHeaders so callers can still override it if needed
  // (e.g. a future explicit-no-auth path); the X-Claim-Token path is unaffected
  // because claim tokens travel in extraHeaders, not Authorization.
  const apiKey = resolveApiKey(opts.apiKey);
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);

  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? (data as { error: string }).error
        : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return data as T;
}

import { PACKAGE_NAME, VERSION } from './version';

export type GlobalOpts = {
  json?: boolean;
  quiet?: boolean;
  apiUrl?: string;
};

function getApiUrl(flagValue?: string): string {
  const url =
    flagValue ??
    process.env.EASL_API_URL ??
    'https://api.easl.dev';
  return url.replace(/\/$/, '');
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

import type { Env } from "../types";

/** Build site URL — uses /s/:slug on localhost, subdomain in production */
export function siteUrl(requestUrl: string, env: Env, slug: string): string {
  const host = new URL(requestUrl).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    const port = new URL(requestUrl).port;
    return `http://${host}${port ? `:${port}` : ""}/s/${slug}`;
  }
  return `https://${slug}.${env.DOMAIN}`;
}

/** Build API URL — uses localhost origin or production API_HOST */
export function apiUrl(requestUrl: string, env: Env, path: string): string {
  const origin = new URL(requestUrl);
  if (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") {
    return `${origin.origin}${path}`;
  }
  return `https://${env.API_HOST}${path}`;
}

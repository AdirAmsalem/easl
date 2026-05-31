import type { Env, SiteMeta } from "../types";
import { verifyPassword } from "../lib/password";
import {
  buildSetCookie,
  parseCookieHeader,
  passwordFingerprint,
  signCookie,
  unlockCookieName,
  verifyCookie,
} from "../lib/session";

/** Path (relative to basePath) where the unlock form posts. */
export const UNLOCK_PATH = "/__unlock";

/**
 * Check whether the request carries a valid unlock cookie for this slug.
 * The cookie is bound to the current password hash, so a rotated password
 * invalidates previously-issued cookies.
 */
export async function isUnlocked(request: Request, env: Env, slug: string, passwordHash: string | null): Promise<boolean> {
  const cookieValue = parseCookieHeader(request.headers.get("Cookie"), unlockCookieName(slug));
  if (!cookieValue) return false;
  const fp = await passwordFingerprint(env.SESSION_SECRET, passwordHash);
  const result = await verifyCookie(env.SESSION_SECRET, slug, fp, cookieValue);
  return result.valid;
}

/** Sign a fresh unlock cookie (used both on unlock and on sliding refresh). */
export async function freshUnlockCookie(env: Env, slug: string, basePath: string, passwordHash: string | null): Promise<string> {
  const fp = await passwordFingerprint(env.SESSION_SECRET, passwordHash);
  const value = await signCookie(env.SESSION_SECRET, slug, fp);
  return buildSetCookie(unlockCookieName(slug), value, {
    path: basePath || "/",
  });
}

/**
 * Handle a POST to the unlock endpoint. Verifies the password against `meta.passwordHash`,
 * sets a 30-day signed cookie on success, redirects back to the requested path.
 */
export async function handleUnlock(
  request: Request,
  env: Env,
  slug: string,
  meta: SiteMeta,
  basePath: string,
): Promise<Response> {
  if (!meta.passwordHash) {
    // Visibility=private but no hash stored — treat as misconfigured, deny.
    return renderGatePage(slug, basePath, { error: "Unable to unlock this site." }, 500);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return renderGatePage(slug, basePath, { error: "Invalid form submission." }, 400);
  }

  const password = formData.get("password");
  const redirect = formData.get("redirect");
  if (typeof password !== "string" || password.length === 0) {
    return renderGatePage(slug, basePath, { error: "Password is required." }, 400);
  }

  const ok = await verifyPassword(password, meta.passwordHash);
  if (!ok) {
    console.log(JSON.stringify({ event: "private_unlock_fail", slug }));
    return renderGatePage(
      slug,
      basePath,
      { error: "Incorrect password.", redirect: typeof redirect === "string" ? redirect : undefined },
      401,
    );
  }

  console.log(JSON.stringify({ event: "private_unlock_success", slug }));
  const setCookie = await freshUnlockCookie(env, slug, basePath, meta.passwordHash);
  const target = typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//")
    ? redirect
    : basePath || "/";
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      "Set-Cookie": setCookie,
      "Cache-Control": "private, no-store",
    },
  });
}

/** Render the password gate page. Used for missing/invalid cookies and unlock failures. */
export function renderGatePage(
  slug: string,
  basePath: string,
  opts: { error?: string; redirect?: string } = {},
  status = 401,
): Response {
  const action = `${basePath}${UNLOCK_PATH}`;
  const redirect = opts.redirect && opts.redirect.startsWith("/") && !opts.redirect.startsWith("//")
    ? opts.redirect
    : (basePath || "/");
  const errorBlock = opts.error
    ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Locked · ${escapeHtml(slug)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
  .card{width:100%;max-width:380px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:2rem;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
  .lock{width:32px;height:32px;color:#737373;margin-bottom:1rem}
  h1{font-size:1.125rem;font-weight:600;margin-bottom:0.25rem}
  p.sub{color:#737373;font-size:0.875rem;margin-bottom:1.5rem}
  label{display:block;font-size:0.8125rem;font-weight:500;margin-bottom:0.375rem;color:#374151}
  input{width:100%;padding:0.625rem 0.75rem;border:1px solid #d4d4d8;border-radius:8px;font-size:0.9375rem;outline:none;transition:border-color 0.15s,box-shadow 0.15s}
  input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.1)}
  button{width:100%;margin-top:1rem;padding:0.625rem 1rem;background:#1a1a1a;color:#fff;border:none;border-radius:8px;font-size:0.9375rem;font-weight:500;cursor:pointer;transition:background 0.15s}
  button:hover{background:#404040}
  .err{margin-top:0.75rem;color:#b91c1c;font-size:0.8125rem}
</style></head>
<body>
  <form class="card" method="POST" action="${escapeHtml(action)}" autocomplete="off">
    <svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <h1>This easl is private</h1>
    <p class="sub">Enter the password to view <strong>${escapeHtml(slug)}</strong>.</p>
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autofocus required>
    <input type="hidden" name="redirect" value="${escapeHtml(redirect)}">
    <button type="submit">Unlock</button>
    ${errorBlock}
  </form>
</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

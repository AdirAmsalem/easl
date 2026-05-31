import type { Context } from "hono";
import type { Env } from "../types";
import { AUTH_BASE_PATH } from "./index";

type Ctx = Context<{ Bindings: Env }>;

/**
 * Validate the `next` redirect target so an attacker can't turn the login page
 * into an open redirect. We only allow:
 *   - a same-origin absolute URL (the login page's own origin), or
 *   - an absolute URL whose host is the apex domain or a direct subdomain of it
 *     (`<DOMAIN>` or `*.<DOMAIN>`), which is where private sites live, or
 *   - a root-relative path (`/...`, but not `//...` which is protocol-relative).
 *
 * The account gate always builds `next` from the denied site's own origin+path
 * (see serve/handler.ts buildLoginRedirect), so a legitimate `next` is always one
 * of these. Anything else (cross-site URL, garbage) falls back to the apex domain.
 */
export function sanitizeNext(env: Env, requestUrl: string, next: string | null | undefined): string {
  const fallback = `https://${env.DOMAIN}/`;
  if (!next) return fallback;

  // Root-relative path: allow `/path` but reject `//host` (protocol-relative) and
  // backslash tricks (`/\host`) some browsers normalise to protocol-relative.
  if (next.startsWith("/")) {
    if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
    return next;
  }

  let target: URL;
  try {
    target = new URL(next);
  } catch {
    return fallback;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return fallback;

  const here = new URL(requestUrl);
  if (target.host === here.host) return target.toString();

  // Apex domain or any direct subdomain of it (where private sites are served).
  const host = target.hostname;
  if (host === env.DOMAIN || host.endsWith(`.${env.DOMAIN}`)) return target.toString();

  return fallback;
}

/**
 * Validate the `cli_port` the `easl login` handshake passes (GET
 * /auth/login?cli_port=<port>). Returns the numeric port string when it's a
 * plausible TCP port, else null. Used to derive the magic-link callbackURL that
 * routes the post-verify browser to /auth/cli-callback (which mints the API key
 * and bounces to the CLI's loopback). Mirrors cli-callback.ts loopbackCallbackUrl.
 */
export function sanitizeCliPort(port: string | null | undefined): string | null {
  if (!port || !/^\d{1,5}$/.test(port)) return null;
  const n = Number(port);
  if (n < 1 || n > 65535) return null;
  return String(n);
}

/**
 * Serve the magic-link sign-in page (GET /auth/login?next=<url> | ?cli_port=<port>).
 *
 * better-auth is headless — it exposes only API endpoints (/auth/sign-in/magic-link,
 * /auth/magic-link/verify, /auth/get-session, …) and NO /auth/login HTML page. The
 * serve handler's account gate 302s unauthenticated visitors to /auth/login, so this
 * route must exist and return 200, or the anonymous→login→view flow dead-ends in the
 * better-auth /auth/* catch-all (404). Mounted on the api app BEFORE mountAuth so it
 * claims /auth/login ahead of better-auth's wildcard.
 *
 * The page collects an email and POSTs it to /auth/sign-in/magic-link with a
 * `callbackURL`. After the user clicks the emailed link, better-auth verifies the
 * token, sets the (cross-subdomain) session cookie, and redirects to that URL:
 *   - Browser gate flow: `callbackURL = next` (the denied private site) — the
 *     visitor lands back on the page they were gated from.
 *   - CLI handshake (`?cli_port=<port>`): `callbackURL = /auth/cli-callback?port=<port>`
 *     (a root-relative same-origin path sanitizeNext permits), which mints an API key
 *     and 302s to the CLI's loopback. `cli_port` takes precedence over `next` since
 *     the two flows are mutually exclusive (the CLI never sets `next`).
 */
export function handleLoginPage(c: Ctx): Response {
  const cliPort = sanitizeCliPort(c.req.query("cli_port"));
  const callbackURL = cliPort
    ? `${AUTH_BASE_PATH}/cli-callback?port=${cliPort}`
    : sanitizeNext(c.env, c.req.url, c.req.query("next"));
  console.log(JSON.stringify({ event: "auth_login_page", cli: Boolean(cliPort) }));
  return c.html(loginPageHtml(callbackURL));
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function loginPageHtml(callbackURL: string): string {
  // `callbackURL` is validated (sanitizeNext / sanitizeCliPort) and HTML-escaped
  // here; the JS reads it from a data attribute and sends it as the magic-link
  // callbackURL (the post-verify redirect target).
  const signInPath = `${AUTH_BASE_PATH}/sign-in/magic-link`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · easl</title>
<meta name="robots" content="noindex, nofollow">
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
  button:disabled{opacity:0.6;cursor:not-allowed}
  .msg{margin-top:0.75rem;font-size:0.8125rem}
  .msg.err{color:#b91c1c}
  .msg.ok{color:#047857}
</style></head>
<body>
  <form class="card" id="login-form" autocomplete="off" data-next="${escapeHtml(callbackURL)}" data-signin="${escapeHtml(signInPath)}">
    <svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <h1>Sign in to easl</h1>
    <p class="sub">Enter your email and we'll send you a sign-in link.</p>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" autofocus required>
    <button type="submit" id="submit">Send sign-in link</button>
    <p class="msg" id="msg" role="status"></p>
  </form>
  <script>
    (function(){
      var form=document.getElementById('login-form');
      var submit=document.getElementById('submit');
      var msg=document.getElementById('msg');
      var next=form.getAttribute('data-next');
      var signin=form.getAttribute('data-signin');
      form.addEventListener('submit',function(e){
        e.preventDefault();
        var email=document.getElementById('email').value.trim();
        if(!email)return;
        submit.disabled=true;
        msg.className='msg';
        msg.textContent='Sending…';
        fetch(signin,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({email:email,callbackURL:next})
        }).then(function(r){
          if(r.ok){
            msg.className='msg ok';
            msg.textContent='Check your email for a sign-in link.';
          }else{
            submit.disabled=false;
            msg.className='msg err';
            msg.textContent='Could not send the link. Try again in a moment.';
          }
        }).catch(function(){
          submit.disabled=false;
          msg.className='msg err';
          msg.textContent='Network error. Try again.';
        });
      });
    })();
  </script>
</body></html>`;
}

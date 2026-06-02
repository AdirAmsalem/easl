import type { Context } from "hono";
import type { Env } from "../types";
import { AUTH_BASE_PATH } from "./index";
import { isBetterAuthSecretConfigured, signCliCallbackMarker } from "../lib/session";

type Ctx = Context<{ Bindings: Env }>;

/** KV key prefix for the per-IP CLI-marker mint throttle. */
const CLI_MARKER_RL_PREFIX = "cli-mark-rl:";

/**
 * Per-IP throttle on CLI-marker minting. Only the `cli_port` branch of the login
 * page mints a worker-signed `cb` marker, and that endpoint is unauthenticated, so
 * an attacker could otherwise harvest an unlimited supply of fresh valid markers
 * (each one a single CSRF attempt against a logged-in victim's cli-callback). This
 * caps minting to `MARKER_MINT_MAX` per `MARKER_MINT_WINDOW_S` per client IP, so a
 * harvest-and-replay campaign is rate-limited at the source. The non-CLI gate flow
 * (no `cli_port`, no marker) is never throttled — it mints nothing.
 */
const MARKER_MINT_MAX = 10;
const MARKER_MINT_WINDOW_S = 10 * 60; // 10 minutes — comfortably above one real `easl login`.

/**
 * Resolve the client IP from Cloudflare's trusted edge header. `cf-connecting-ip`
 * is set by Cloudflare (un-spoofable, single IP), the same header makeAuth keys
 * its magic-link limiter on. Returns null when absent (e.g. the local test
 * runtime) so the caller can skip throttling rather than collapse every client
 * into one shared bucket.
 */
function clientIp(c: Ctx): string | null {
  return c.req.header("cf-connecting-ip") ?? null;
}

/**
 * Returns true if minting a CLI marker for this IP is allowed (and records the
 * attempt), false if the per-IP cap is exceeded. Best-effort, KV-backed: a KV
 * error fails OPEN (allow) — the marker is still single-use + port-bound + capped
 * downstream, so this throttle is defense-in-depth, not the sole gate, and must not
 * break legitimate logins on a transient KV blip. Skips (allows) when no client IP
 * is resolvable.
 */
async function allowMarkerMint(c: Ctx): Promise<boolean> {
  const ip = clientIp(c);
  if (!ip) return true;
  const key = `${CLI_MARKER_RL_PREFIX}${ip}`;
  try {
    const raw = await c.env.SITES_KV.get(key);
    const count = raw ? Number(raw) : 0;
    if (Number.isFinite(count) && count >= MARKER_MINT_MAX) return false;
    // expirationTtl floors at 60s; MARKER_MINT_WINDOW_S is well above. This is a
    // fixed-window counter — good enough to throttle a harvest campaign.
    await c.env.SITES_KV.put(key, String((Number.isFinite(count) ? count : 0) + 1), {
      expirationTtl: MARKER_MINT_WINDOW_S,
    });
    return true;
  } catch {
    return true;
  }
}

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
 * Describe the easl a (sanitized) `next` points at, for the contextual sign-in
 * copy. The account gate always builds `next` from the denied site's own URL (see
 * serve/handler.ts buildLoginRedirect), so when a visitor is bounced here from a
 * private easl, `next` identifies which one. Returns a display label:
 *   - subdomain routing: the full host (e.g. `bright-hill-436f.easl.dev`) — exactly
 *     what the visitor typed.
 *   - path routing / local dev / previews: the slug from `/s/<slug>`.
 * Returns null when `next` is absent or points at the apex, `www`, or the API host
 * (a direct /auth/login visit or the CLI handshake) — those keep the generic copy.
 *
 * Defensive: `next` is expected post-sanitizeNext (an apex/subdomain absolute URL
 * or a root-relative path), but we parse with a base and return null on anything
 * odd so a malformed value just falls back to the generic page.
 */
export function describeEaslTarget(env: Env, next: string | null | undefined): string | null {
  if (!next) return null;
  let target: URL;
  try {
    target = new URL(next, `https://${env.DOMAIN}`);
  } catch {
    return null;
  }

  // Subdomain routing: a direct, non-reserved subdomain of DOMAIN IS the easl, so
  // show the host (the slug lives in the hostname, not the path). Checked before the
  // `/s/<slug>` path so a private subdomain easl with a `/s/...` subpath still
  // reports its host rather than mistaking the subpath for a slug.
  const host = target.hostname;
  const apiHost = env.API_HOST || `api.${env.DOMAIN}`;
  const reserved = new Set([env.DOMAIN, `www.${env.DOMAIN}`, apiHost]);
  if (host.endsWith(`.${env.DOMAIN}`) && !reserved.has(host)) return host;

  // Path-based routing (/s/<slug>/...) on the apex, localhost, or workers.dev
  // previews — the slug is the distinctive part.
  const pathMatch = target.pathname.match(/^\/s\/([^/]+)/);
  if (pathMatch) {
    try {
      return decodeURIComponent(pathMatch[1]) || null;
    } catch {
      return pathMatch[1] || null;
    }
  }

  return null;
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
 * Validate the CLI-generated `cli_state` nonce the `easl login` handshake threads
 * through the login page (GET /auth/login?cli_port=<port>&cli_state=<state>).
 *
 * The CLI mints a random state, the worker echoes it back on the loopback
 * redirect, and the CLI's loopback server rejects any /callback whose state does
 * not match — so a local page racing the ephemeral port during the login window
 * can't inject an attacker-owned key. We only accept an opaque, URL-safe token of
 * bounded length (base64url/hex shaped); anything else is dropped (returns null)
 * so a malformed value can't smuggle extra query params into the callbackURL.
 */
export function sanitizeCliState(state: string | null | undefined): string | null {
  if (!state) return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return null;
  return state;
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
 *   - CLI handshake (`?cli_port=<port>`): `callbackURL =
 *     /auth/cli-callback?port=<port>&cb=<marker>[&cli_state=<state>]` (a
 *     root-relative same-origin path sanitizeNext permits), which mints an API key
 *     and 302s to the CLI's loopback. `cli_port` takes precedence over `next` since
 *     the two flows are mutually exclusive (the CLI never sets `next`).
 *
 * The `cb` marker is a single-use, worker-SIGNED value bound to the port (see
 * lib/session.ts signCliCallbackMarker). cli-callback verifies it BEFORE minting
 * a key, so a logged-in user lured straight to /auth/cli-callback (carrying only
 * the SameSite=Lax session cookie, no marker) can't mint anything. Because THIS
 * page is unauthenticated, marker minting is rate-limited per IP (allowMarkerMint)
 * so an attacker can't cheaply harvest a fresh marker per CSRF attempt; over the
 * cap we render the bare sign-in UI WITHOUT a marker (429). The optional
 * `cli_state` is the CLI-generated nonce echoed back to the loopback so the CLI
 * can reject a response not tied to THIS login attempt.
 *
 * Returns a promise: minting the marker is async (HMAC). The CLI path needs
 * BETTER_AUTH_SECRET (cli-callback can't complete without it either), so when the
 * secret is unconfigured we render the page WITHOUT CLI wiring — the bare sign-in
 * UI still renders (it 503s at sign-in like any other auth route), but no
 * unsigned cli-callback target is ever emitted.
 */
export async function handleLoginPage(c: Ctx): Promise<Response> {
  const cliPort = sanitizeCliPort(c.req.query("cli_port"));
  const cliState = sanitizeCliState(c.req.query("cli_state"));

  let callbackURL: string;
  let easlLabel: string | null = null;
  if (cliPort && isBetterAuthSecretConfigured(c.env.BETTER_AUTH_SECRET)) {
    // Throttle marker minting per IP: this endpoint is unauthenticated, so without
    // a cap an attacker could harvest unlimited fresh markers to fuel CSRF attempts
    // against logged-in victims' cli-callback. Over the cap, refuse to mint a marker
    // (429) — the bare sign-in UI still renders, but no `cb` is emitted.
    if (!(await allowMarkerMint(c))) {
      console.log(JSON.stringify({ event: "auth_login_page_marker_throttled" }));
      return c.html(loginPageHtml(sanitizeNext(c.env, c.req.url, c.req.query("next"))), 429);
    }
    const { marker } = await signCliCallbackMarker(c.env.BETTER_AUTH_SECRET, cliPort);
    const params = new URLSearchParams({ port: cliPort, cb: marker });
    if (cliState) params.set("cli_state", cliState);
    callbackURL = `${AUTH_BASE_PATH}/cli-callback?${params.toString()}`;
  } else {
    callbackURL = sanitizeNext(c.env, c.req.url, c.req.query("next"));
    // Contextual copy when the visitor was bounced here from a private easl gate
    // (callbackURL === the sanitized `next`). The CLI branch above stays generic.
    easlLabel = describeEaslTarget(c.env, callbackURL);
  }

  console.log(JSON.stringify({ event: "auth_login_page", cli: Boolean(cliPort) }));
  return c.html(loginPageHtml(callbackURL, easlLabel));
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function loginPageHtml(callbackURL: string, easlLabel?: string | null): string {
  // `callbackURL` is validated (sanitizeNext / sanitizeCliPort) and HTML-escaped
  // here; the JS reads it from a data attribute and sends it as the magic-link
  // callbackURL (the post-verify redirect target).
  const signInPath = `${AUTH_BASE_PATH}/sign-in/magic-link`;
  // `easlLabel`, when set, means the visitor was redirected here from a private
  // easl's account gate — name it and nudge them toward the email they published
  // from (a fresh email signs in fine but then hits the 403 "not yours" page).
  // It's sanitizeNext-derived (apex/subdomain host or `/s/<slug>` slug) and escaped.
  const heading = easlLabel ? "This easl is private" : "Sign in to easl";
  const sub = easlLabel
    ? `Sign in to view <strong>${escapeHtml(easlLabel)}</strong>. Use the email you published it from and we'll send you a sign-in link.`
    : "Enter your email and we'll send you a sign-in link.";
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
    <h1>${heading}</h1>
    <p class="sub">${sub}</p>
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

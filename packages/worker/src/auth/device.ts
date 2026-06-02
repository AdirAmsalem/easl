import type { Context } from "hono";
import type { Env } from "../types";
import {
  AUTH_BASE_PATH,
  AuthSecretUnconfiguredError,
  authBaseURL,
  makeAuth,
  type EaslAuth,
} from "./index";
import { isBetterAuthSecretConfigured } from "../lib/session";
import { CLI_KEY_NAME, CLI_KEY_TTL_SECONDS } from "./cli-callback";

type Ctx = Context<{ Bindings: Env }>;

/**
 * Path (on the api origin) of the human device-approval page. The
 * deviceAuthorization plugin's `verificationUri` points here, and this is what
 * the CLI prints for `easl login --device`. NOT under /auth/* so it never
 * collides with the plugin's own `/auth/device` JSON endpoint.
 */
export const DEVICE_PAGE_PATH = "/device";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The device-approval pages are the security boundary for minting a CLI session,
 * so (like the cli-callback consent page) they are never framed and never cached.
 */
function pageHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  };
}

/**
 * Construct the auth instance, mapping an unconfigured secret to a 503 (caller
 * returns it). Mirrors the fail-closed handling in cli-callback.ts.
 */
function tryMakeAuth(c: Ctx): EaslAuth | null {
  if (!isBetterAuthSecretConfigured(c.env.BETTER_AUTH_SECRET)) return null;
  try {
    return makeAuth(c.env);
  } catch (err) {
    if (err instanceof AuthSecretUnconfiguredError) return null;
    throw err;
  }
}

/** Resolve the signed-in user from the request cookie, or null if anonymous. */
async function resolveSession(
  auth: EaslAuth,
  c: Ctx,
): Promise<{ userId: string; email: string } | null> {
  let session: { user?: { id?: unknown; email?: unknown } | null } | null;
  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers });
  } catch (err) {
    console.log(JSON.stringify({ event: "device_session_failed", error: String(err) }));
    return null;
  }
  if (!session?.user || typeof session.user.id !== "string") return null;
  const email = typeof session.user.email === "string" ? session.user.email : "";
  return { userId: session.user.id, email };
}

/**
 * Reject a cross-site POST. The session cookie is SameSite=Lax (so a cross-site
 * POST does not carry it → resolveSession already fails), and this Origin check
 * is defense-in-depth: browsers send `Origin` on same-origin POSTs, so a present
 * Origin must be the api origin, the apex, or a `*.<DOMAIN>` subdomain.
 */
function originAllowed(c: Ctx): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true; // non-browser / same-origin form posts may omit it
  if (origin === authBaseURL(c.env)) return true;
  try {
    const host = new URL(origin).hostname;
    return host === c.env.DOMAIN || host.endsWith(`.${c.env.DOMAIN}`);
  } catch {
    return false;
  }
}

/**
 * GET /device[?user_code=…] — the human approval page for `easl login --device`.
 *
 * Flow:
 *   1. No session → 302 to the magic-link sign-in page, returning here (with the
 *      code) after the user signs in.
 *   2. Signed in, no code → render a form to enter the code shown by the CLI.
 *   3. Signed in + code → CLAIM the code to this user (GET /auth/device binds
 *      userId) and render the Authorize / Deny consent page.
 *
 * Nothing is minted here; approval happens on the POST, and the CLI exchanges the
 * resulting session for an API key on /auth/device/token → /auth/api-key/create.
 */
export async function handleDevicePage(c: Ctx): Promise<Response> {
  const auth = tryMakeAuth(c);
  if (!auth) {
    console.error(JSON.stringify({ event: "device_page_secret_unconfigured" }));
    return c.json({ error: "Authentication is not configured." }, 503);
  }

  const userCode = (c.req.query("user_code") ?? "").trim();

  const session = await resolveSession(auth, c);
  if (!session) {
    // Bounce through magic-link sign-in, returning to this page (with the code)
    // afterwards. `next` is a root-relative path sanitizeNext permits.
    const next = userCode
      ? `${DEVICE_PAGE_PATH}?user_code=${encodeURIComponent(userCode)}`
      : DEVICE_PAGE_PATH;
    console.log(JSON.stringify({ event: "device_page_no_session" }));
    return c.redirect(`${AUTH_BASE_PATH}/login?next=${encodeURIComponent(next)}`, 302);
  }

  if (!userCode) {
    return c.html(enterCodePageHtml(session.email), 200, pageHeaders());
  }

  // Claim the code to this user, then read its status.
  const origin = authBaseURL(c.env);
  const cookie = c.req.header("cookie") ?? "";
  let status: string | null = null;
  try {
    const verifyRes = await auth.handler(
      new Request(
        `${origin}${AUTH_BASE_PATH}/device?user_code=${encodeURIComponent(userCode)}`,
        { headers: { cookie } },
      ),
    );
    if (!verifyRes.ok) {
      console.log(JSON.stringify({ event: "device_page_verify_rejected", httpStatus: verifyRes.status }));
      return c.html(
        resultPageHtml({
          kind: "error",
          title: "Invalid or expired code",
          message: "That code isn’t valid or has expired. Start the sign-in again from your terminal.",
        }),
        200,
        pageHeaders(),
      );
    }
    const body = await verifyRes.json<{ status?: string }>();
    status = typeof body.status === "string" ? body.status : null;
  } catch (err) {
    console.error(JSON.stringify({ event: "device_page_verify_error", error: String(err) }));
    return c.html(
      resultPageHtml({ kind: "error", title: "Something went wrong", message: "Please try again from your terminal." }),
      500,
      pageHeaders(),
    );
  }

  if (status === "approved") {
    return c.html(
      resultPageHtml({ kind: "ok", title: "Already authorized", message: "This device is already authorized — return to your terminal." }),
      200,
      pageHeaders(),
    );
  }
  if (status === "denied") {
    return c.html(
      resultPageHtml({ kind: "error", title: "Request denied", message: "This sign-in request was denied." }),
      200,
      pageHeaders(),
    );
  }

  console.log(JSON.stringify({ event: "device_page_consent_rendered" }));
  return c.html(consentPageHtml({ userCode, email: session.email }), 200, pageHeaders());
}

/** POST /device/approve — approve the device-flow code shown by the CLI. */
export function handleDeviceApprove(c: Ctx): Promise<Response> {
  return handleDecision(c, "approve");
}

/** POST /device/deny — deny the device-flow code. */
export function handleDeviceDeny(c: Ctx): Promise<Response> {
  return handleDecision(c, "deny");
}

/** Coerce a stored `date` value (epoch ms number or ISO string) to epoch ms, or null. */
function toEpochMs(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Date.parse(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * POST /device/cli-key — the CLI's final step in `easl login --device`.
 *
 * better-auth's /auth/device/token returns the approved session token in its JSON
 * body (`access_token`) and does NOT reliably set a session cookie (it's an OAuth
 * token endpoint, and the cookie is HMAC-signed so the CLI can't forge one). So the
 * CLI hands that session token here and we exchange it, server-side, for an `easl_`
 * API key: resolve the token's owner from the session table, then mint via the
 * api-key plugin's SERVER-ONLY `userId` path (auth.api.createApiKey — never
 * auth.handler, which carries a request context the plugin rejects `userId` on).
 *
 * The session token is a high-entropy secret only the polling CLI holds, so
 * presenting it proves this device's flow was approved for that user.
 */
export async function handleDeviceCliKey(c: Ctx): Promise<Response> {
  const auth = tryMakeAuth(c);
  if (!auth) {
    console.error(JSON.stringify({ event: "device_cli_key_secret_unconfigured" }));
    return c.json({ error: "Authentication is not configured." }, 503);
  }

  const body = await c.req.json<{ device_token?: unknown }>().catch(() => null);
  const deviceToken =
    body && typeof body.device_token === "string" ? body.device_token.trim() : "";
  if (!deviceToken) return c.json({ error: "missing_device_token" }, 400);

  const row = await c.env.DB.prepare(
    'SELECT "userId" AS userId, "expiresAt" AS expiresAt FROM "session" WHERE "token" = ?',
  )
    .bind(deviceToken)
    .first<{ userId?: string; expiresAt?: string | number }>();
  if (!row || typeof row.userId !== "string") {
    console.log(JSON.stringify({ event: "device_cli_key_invalid_token" }));
    return c.json({ error: "invalid_token" }, 401);
  }
  const expMs = toEpochMs(row.expiresAt);
  if (expMs !== null && expMs < Date.now()) {
    console.log(JSON.stringify({ event: "device_cli_key_expired_token" }));
    return c.json({ error: "invalid_token" }, 401);
  }

  // Mint server-side for the resolved user. `createApiKey` accepts a `userId` only
  // when there is NO request context — auth.api (not auth.handler) provides that.
  // The type is cast because EaslAuth narrows `api` to the plugin-less surface.
  const created = await (
    auth.api as unknown as {
      createApiKey: (args: {
        body: { userId: string; name: string; expiresIn: number | null };
      }) => Promise<{ key: string; id: string }>;
    }
  ).createApiKey({
    body: { userId: row.userId, name: CLI_KEY_NAME, expiresIn: CLI_KEY_TTL_SECONDS },
  });

  console.log(JSON.stringify({ event: "device_cli_key_minted" }));
  return c.json({ key: created.key, id: created.id }, 200, { "Cache-Control": "no-store" });
}

async function handleDecision(c: Ctx, decision: "approve" | "deny"): Promise<Response> {
  const auth = tryMakeAuth(c);
  if (!auth) {
    console.error(JSON.stringify({ event: "device_decision_secret_unconfigured" }));
    return c.json({ error: "Authentication is not configured." }, 503);
  }

  if (!originAllowed(c)) {
    console.log(JSON.stringify({ event: "device_decision_bad_origin" }));
    return c.json({ error: "Forbidden." }, 403);
  }

  const session = await resolveSession(auth, c);
  if (!session) {
    return c.html(
      resultPageHtml({ kind: "error", title: "Not signed in", message: "Your session expired. Start the sign-in again from your terminal." }),
      401,
      pageHeaders(),
    );
  }

  const form = await c.req.parseBody();
  const userCode = typeof form.userCode === "string" ? form.userCode.trim() : "";
  if (!userCode) return c.json({ error: "Missing user code." }, 400);

  const origin = authBaseURL(c.env);
  const cookie = c.req.header("cookie") ?? "";

  // Claim the code to this user first (idempotent — the GET page normally does
  // it). The plugin's approve/deny both require the code to be claimed, and only
  // its claimant (userId === session.user.id) may decide it.
  await auth.handler(
    new Request(`${origin}${AUTH_BASE_PATH}/device?user_code=${encodeURIComponent(userCode)}`, {
      headers: { cookie },
    }),
  );

  const res = await auth.handler(
    new Request(`${origin}${AUTH_BASE_PATH}/device/${decision}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ userCode }),
    }),
  );

  if (res.ok) {
    console.log(JSON.stringify({ event: `device_${decision}_ok` }));
    return c.html(
      decision === "approve"
        ? resultPageHtml({ kind: "ok", title: "Device authorized", message: "Return to your terminal — the easl CLI is finishing sign-in." })
        : resultPageHtml({ kind: "ok", title: "Request denied", message: "The sign-in request was denied. Nothing was authorized." }),
      200,
      pageHeaders(),
    );
  }

  let message = "That code isn’t valid or has already been used.";
  try {
    const body = await res.json<{ error_description?: string }>();
    if (typeof body.error_description === "string" && body.error_description) message = body.error_description;
  } catch {
    // keep the default message
  }
  console.log(JSON.stringify({ event: `device_${decision}_failed`, httpStatus: res.status }));
  return c.html(
    resultPageHtml({ kind: "error", title: "Couldn’t complete that", message }),
    200,
    pageHeaders(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML (light-mode card UI, matching the magic-link sign-in page in auth/login.ts)
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_STYLE = `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
.card{width:100%;max-width:400px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:2rem;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
h1{font-size:1.125rem;font-weight:600;margin-bottom:0.25rem}
p.sub{color:#737373;font-size:0.875rem;margin-bottom:1.25rem}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.5rem;font-weight:600;letter-spacing:0.15em;text-align:center;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:8px;padding:0.75rem;margin:0 0 1.25rem}
.warn{font-size:0.8125rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:0.625rem 0.75rem;margin-bottom:1.25rem}
form{display:inline}
button{padding:0.625rem 1rem;border:none;border-radius:8px;font-size:0.9375rem;font-weight:500;cursor:pointer}
.btn-row{display:flex;gap:0.5rem}
.btn-primary{flex:1;background:#1a1a1a;color:#fff}
.btn-primary:hover{background:#404040}
.btn-secondary{flex:1;background:#fff;color:#374151;border:1px solid #d4d4d8}
.btn-secondary:hover{background:#f5f5f5}
input{width:100%;padding:0.625rem 0.75rem;border:1px solid #d4d4d8;border-radius:8px;font-size:1rem;letter-spacing:0.1em;text-transform:uppercase;outline:none;margin-bottom:1rem}
input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.1)}
.who{font-size:0.8125rem;color:#737373;margin-top:1rem}
.ok h1{color:#047857}.err h1{color:#b91c1c}`;

function shell(inner: string, klass = ""): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize device · easl</title>
<meta name="robots" content="noindex, nofollow">
<style>${PAGE_STYLE}</style></head>
<body><div class="card ${klass}">${inner}</div></body></html>`;
}

function consentPageHtml(opts: { userCode: string; email: string }): string {
  const code = escapeHtml(opts.userCode);
  return shell(`
    <h1>Authorize the easl CLI?</h1>
    <p class="sub">A device is requesting access to your easl account.</p>
    <div class="code">${code}</div>
    <div class="warn">Only approve this if you just started <strong>easl login</strong> on a device you control, and this code matches the one shown there.</div>
    <div class="btn-row">
      <form method="POST" action="${DEVICE_PAGE_PATH}/approve">
        <input type="hidden" name="userCode" value="${code}">
        <button type="submit" class="btn-primary">Authorize</button>
      </form>
      <form method="POST" action="${DEVICE_PAGE_PATH}/deny">
        <input type="hidden" name="userCode" value="${code}">
        <button type="submit" class="btn-secondary">Deny</button>
      </form>
    </div>
    <p class="who">Signed in as ${escapeHtml(opts.email)}</p>`);
}

function enterCodePageHtml(email: string): string {
  return shell(`
    <h1>Enter your device code</h1>
    <p class="sub">Type the code shown in your terminal by <strong>easl login</strong>.</p>
    <form method="GET" action="${DEVICE_PAGE_PATH}">
      <input name="user_code" placeholder="ABCD-EFGH" autocomplete="off" autofocus required>
      <button type="submit" class="btn-primary" style="width:100%">Continue</button>
    </form>
    <p class="who">Signed in as ${escapeHtml(email)}</p>`);
}

function resultPageHtml(opts: { kind: "ok" | "error"; title: string; message: string }): string {
  return shell(
    `<h1>${escapeHtml(opts.title)}</h1><p class="sub">${escapeHtml(opts.message)}</p>`,
    opts.kind === "ok" ? "ok" : "err",
  );
}

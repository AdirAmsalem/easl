import type { Context } from "hono";
import type { Env } from "../types";
import { makeAuth, AUTH_BASE_PATH, AuthSecretUnconfiguredError, authBaseURL } from "./index";

type Ctx = Context<{ Bindings: Env }>;

/**
 * The loopback callback path the `easl login` CLI server listens on (mirrors
 * lib/auth-server.ts CALLBACK_PATH). The CLI passes only the ephemeral PORT to the
 * worker (via `cli_port`); the host + path are fixed here so a forged `cli_port`
 * can never aim the redirect anywhere but the user's own machine.
 */
const LOOPBACK_PATH = "/callback";

/**
 * Validate the CLI loopback port and build the exact `http://127.0.0.1:<port>/callback`
 * target. Returns null for anything that isn't a plausible TCP port — the redirect
 * target is otherwise fully fixed (loopback host + path), so this is the ONLY
 * attacker-influenced input and it can only ever name a port on 127.0.0.1.
 */
export function loopbackCallbackUrl(port: string | null | undefined): string | null {
  if (!port || !/^\d{1,5}$/.test(port)) return null;
  const n = Number(port);
  if (n < 1 || n > 65535) return null;
  return `http://127.0.0.1:${n}${LOOPBACK_PATH}`;
}

/**
 * Complete the `easl login` browser handshake (GET /auth/cli-callback?port=<port>).
 *
 * The CLI opens `…/auth/login?cli_port=<port>`; the login page sends the magic-link
 * with `callbackURL = /auth/cli-callback?port=<port>` (a root-relative, same-origin
 * path that sanitizeNext permits). After the user clicks the emailed link,
 * better-auth verifies the token, sets the session cookie, and 302s the browser
 * here WITH that cookie. This route then:
 *   1. mints a fresh `easl_<…>` API key for the now-authenticated session
 *      (server-side, via better-auth's own /api-key/create), and
 *   2. 302s the browser to the loopback `http://127.0.0.1:<port>/callback?key=…&id=…&email=…`
 *      so the waiting CLI server (auth-server.ts waitForKey) receives the key.
 *
 * This is the ONLY place a loopback redirect is allowed, and only to 127.0.0.1 on
 * a validated numeric port — the general open-redirect guard (login.ts sanitizeNext)
 * still rejects loopback `next` targets, so this dedicated, narrowly-scoped route is
 * what makes the headline browser flow work without widening that guard.
 *
 * Without a session (cookie missing/expired) it bounces back to the sign-in page,
 * re-attaching `cli_port` so a retry still completes the handshake.
 */
export async function handleCliCallback(c: Ctx): Promise<Response> {
  const port = c.req.query("port");
  const loopback = loopbackCallbackUrl(port);
  if (!loopback) {
    console.log(JSON.stringify({ event: "cli_callback_bad_port", port }));
    return c.json({ error: "Invalid or missing CLI callback port." }, 400);
  }

  let auth;
  try {
    auth = makeAuth(c.env);
  } catch (err) {
    if (err instanceof AuthSecretUnconfiguredError) {
      console.error(JSON.stringify({ event: "cli_callback_secret_unconfigured" }));
      return c.json({ error: "Authentication is not configured." }, 503);
    }
    throw err;
  }

  // The session cookie set by magic-link verify rides in on this request.
  let session: { user?: { id?: unknown; email?: unknown } | null } | null;
  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers });
  } catch (err) {
    console.log(JSON.stringify({ event: "cli_callback_session_failed", error: String(err) }));
    session = null;
  }

  const email = typeof session?.user?.email === "string" ? session.user.email : "";
  if (!session?.user || typeof session.user.id !== "string") {
    // No session yet (e.g. cookie not set / expired). Send back to the sign-in page,
    // preserving cli_port so a fresh magic link routes back through here.
    const back = `${AUTH_BASE_PATH}/login?cli_port=${encodeURIComponent(port!)}`;
    console.log(JSON.stringify({ event: "cli_callback_no_session" }));
    return c.redirect(back, 302);
  }

  // Mint the key server-side by replaying the cookie to better-auth's own
  // /api-key/create handler (same path the e2e api-key lifecycle test drives). The
  // full key is returned exactly once, here, and handed to the CLI via the loopback.
  // Origin must match a trusted origin or better-auth's CSRF guard rejects the POST.
  const origin = authBaseURL(c.env);
  const cookie = c.req.header("cookie") ?? c.req.header("Cookie") ?? "";
  const createRes = await auth.handler(
    new Request(`${origin}${AUTH_BASE_PATH}/api-key/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, origin },
      body: JSON.stringify({ name: "easl-cli" }),
    }),
  );
  if (!createRes.ok) {
    console.error(
      JSON.stringify({ event: "cli_callback_key_mint_failed", status: createRes.status }),
    );
    return c.json({ error: "Could not create an API key for this session." }, 502);
  }
  const created = await createRes.json<{ id?: string; key?: string }>();
  if (!created.key) {
    console.error(JSON.stringify({ event: "cli_callback_key_missing" }));
    return c.json({ error: "Could not create an API key for this session." }, 502);
  }

  const target = new URL(loopback);
  target.searchParams.set("key", created.key);
  if (created.id) target.searchParams.set("id", created.id);
  if (email) target.searchParams.set("email", email);

  console.log(JSON.stringify({ event: "cli_callback_redirect", hasId: Boolean(created.id) }));
  return c.redirect(target.toString(), 302);
}

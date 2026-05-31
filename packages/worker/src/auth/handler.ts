import type { Hono } from "hono";
import type { Env } from "../types";
import { makeAuth, AUTH_BASE_PATH, AuthSecretUnconfiguredError } from "./index";

/**
 * Mount better-auth's request handler at `/auth/*` on the given Hono app.
 *
 * The factory is invoked per-request (never cached at module scope) because the
 * D1 binding is request-scoped. better-auth owns every method/sub-path under
 * `/auth/*` (sign-in/magic-link, magic-link/verify, sign-out, session, the
 * api-key routes, etc.), so we forward the raw `Request` and return its
 * `Response` verbatim.
 *
 * Fails closed: if BETTER_AUTH_SECRET is unset/placeholder, `makeAuth` throws
 * and we return 503 instead of minting credentials signed with a guessable key.
 */
export function mountAuth(app: Hono<{ Bindings: Env }>): void {
  app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => {
    let auth;
    try {
      auth = makeAuth(c.env);
    } catch (err) {
      if (err instanceof AuthSecretUnconfiguredError) {
        console.error(JSON.stringify({ event: "auth_secret_unconfigured", path: c.req.path }));
        return c.json({ error: "Authentication is not configured." }, 503);
      }
      throw err;
    }
    return auth.handler(c.req.raw);
  });
}

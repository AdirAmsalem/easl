import type { Context } from "hono";
import type { Env } from "../types";
import { makeAuth } from "./index";

/**
 * The minimal authenticated-user shape the rest of the Worker depends on.
 *
 * Deliberately narrow: downstream callers (publish, sites, share-links, claim)
 * only need the stable user id (for `owner_id`) and the email (for logging /
 * display). Keeping the surface small avoids leaking better-auth's full,
 * plugin-parameterised user type — which TypeScript can't emit portably — across
 * module boundaries, and means a future auth-provider swap touches one mapper.
 */
export interface AuthUser {
  id: string;
  email: string;
}

type Ctx = Context<{ Bindings: Env }>;

/**
 * Resolve the better-auth user for a request, or `null` if unauthenticated.
 *
 * Accepts EITHER mechanism, uniformly, by forwarding the raw request headers to
 * better-auth's `getSession`:
 *   - a session cookie (set by the magic-link flow), or
 *   - an `Authorization: Bearer easl_<key>` API key — the api-key plugin is
 *     configured with `enableSessionForAPIKeys`, so a valid key resolves to its
 *     owner's session inside `getSession` (see src/auth/index.ts).
 *
 * Never throws for an absent/invalid credential — it returns `null` so callers
 * can branch (e.g. publish: anonymous is fine unless `private: true`). It also
 * swallows better-auth lookup errors (returning `null`) so a transient auth
 * fault degrades to "unauthenticated" rather than 500-ing a request that may not
 * even require auth. A misconfigured signing secret is the one hard failure: it
 * propagates so the caller can fail closed.
 */
export async function getOptionalUser(c: Ctx): Promise<AuthUser | null> {
  // `makeAuth` throws AuthSecretUnconfiguredError when the signing secret is
  // unset/placeholder. We deliberately let it propagate (fail closed) rather than
  // silently treating the request as anonymous when auth itself can't be trusted.
  const auth = makeAuth(c.env);

  let result: { user?: { id?: unknown; email?: unknown } | null } | null;
  try {
    result = await auth.api.getSession({ headers: c.req.raw.headers });
  } catch (err) {
    // Bad/expired cookie or a rejected API key surfaces here. Treat as anonymous;
    // log for observability without leaking the token.
    console.log(JSON.stringify({ event: "auth_resolve_failed", error: String(err) }));
    return null;
  }

  const user = result?.user;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") {
    return null;
  }
  return { id: user.id, email: user.email };
}

/**
 * Resolve the better-auth user or signal 401.
 *
 * Returns a discriminated result rather than throwing on the unauthenticated
 * path, matching the existing handlers' style of `return c.json(..., 4xx)`:
 *   const auth = await requireUser(c);
 *   if (!auth.ok) return auth.response;   // 401
 *   const user = auth.user;
 *
 * A misconfigured signing secret still throws (via `getOptionalUser`) so it maps
 * to the same fail-closed 503 the auth handler returns, not a misleading 401.
 */
export async function requireUser(
  c: Ctx,
): Promise<{ ok: true; user: AuthUser } | { ok: false; response: Response }> {
  const user = await getOptionalUser(c);
  if (!user) {
    return {
      ok: false,
      response: c.json({ error: "Authentication required. Sign in or pass a valid API key." }, 401),
    };
  }
  return { ok: true, user };
}

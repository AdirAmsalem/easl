import type { Context } from "hono";
import type { Env } from "../types";
import { makeAuth, AuthSecretUnconfiguredError, API_KEY_PREFIX } from "./index";

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
 * True when the request carries something that could resolve a user: a Cookie
 * header (a better-auth session cookie may be in it) OR an `Authorization: Bearer
 * easl_…` API key. Bearer values without our `easl_` prefix are ignored — the
 * api-key plugin only accepts that prefix (see bearerApiKeyGetter), so a stray
 * non-easl bearer can never resolve a session and must not force the auth path.
 */
function hasAuthCredential(c: Ctx): boolean {
  if (c.req.header("cookie") || c.req.header("Cookie")) return true;
  const authz = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!authz) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authz.trim());
  return match != null && match[1].trim().startsWith(API_KEY_PREFIX);
}

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
 * Never throws — it returns `null` for any non-authenticated outcome so callers
 * can branch (e.g. publish: anonymous is fine unless `private: true`; sites: an
 * X-Claim-Token mutation needs no account). Specifically it returns `null` when:
 *   - the request carries no auth credential at all (short-circuited BEFORE
 *     constructing better-auth, so a bare anonymous publish never even touches the
 *     auth machinery and can't be broken by a missing BETTER_AUTH_SECRET),
 *   - the signing secret is unset/placeholder (`AuthSecretUnconfiguredError`):
 *     with no usable secret nobody can be authenticated, so "anonymous" is the
 *     correct optional answer. The auth-REQUIRED callers fail closed on their own
 *     (a null user → 401 in requireUser / share-links / `private:true` publish),
 *     while anonymous public publishing and claim-token mutations keep working —
 *     a forgotten secret must not 500 the zero-friction publish wedge, or
 *   - better-auth rejects a bad/expired cookie or API key.
 */
export async function getOptionalUser(c: Ctx): Promise<AuthUser | null> {
  // Short-circuit: no credential present → anonymous, without constructing
  // better-auth at all. Only a session cookie OR an `Authorization: Bearer easl_…`
  // API key can resolve a user, so absent both there is nothing to look up. This
  // keeps a bare anonymous publish (no auth headers) entirely independent of
  // BETTER_AUTH_SECRET being configured — the agent-native zero-friction default.
  if (!hasAuthCredential(c)) {
    return null;
  }

  // `makeAuth` throws AuthSecretUnconfiguredError when the signing secret is
  // unset/placeholder. On the OPTIONAL path we treat that as "anonymous" (null):
  // failing closed is the job of the auth-required callers (requireUser, etc.),
  // not of every request that merely *might* carry auth.
  let auth;
  try {
    auth = makeAuth(c.env);
  } catch (err) {
    if (err instanceof AuthSecretUnconfiguredError) {
      console.log(JSON.stringify({ event: "auth_secret_unconfigured_optional" }));
      return null;
    }
    throw err;
  }

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

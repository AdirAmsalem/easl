import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import type { Env } from "../types";
import { makeEmailSender, type EmailSender } from "./email";
import { isBetterAuthSecretConfigured } from "../lib/session";

/**
 * Narrow, portable surface of a better-auth instance.
 *
 * `betterAuth(options)` infers a deeply-parameterised `Auth<Options>` whose type
 * transitively references zod internals via the plugin schemas. TypeScript can't
 * emit a portable name for that under `--declaration`/project references (TS2742),
 * and the specific instance is invariant w.r.t. the generic-default `Auth`, so it
 * isn't directly assignable to `Auth` either. We only consume `handler` (Phase 1a)
 * and `api`/`$context` (later phases), so we expose exactly those and cast once.
 */
export type EaslAuth = Pick<Auth, "handler" | "api" | "$context">;

/**
 * Path prefix the auth routes are mounted under (see src/auth/handler.ts and
 * src/index.ts). better-auth needs to know this to build absolute callback URLs.
 */
export const AUTH_BASE_PATH = "/auth";

/** Bearer API-key prefix. Keys look like `easl_<random>`. */
export const API_KEY_PREFIX = "easl_";

/** Magic links expire after 15 minutes. */
const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export interface MakeAuthOptions {
  /** Override the email sender (tests inject a recording mock). */
  emailSender?: EmailSender;
}

/**
 * Thrown by `makeAuth` when `BETTER_AUTH_SECRET` is unset, too short, or left at
 * a known placeholder/default. The handler maps this to a 503 so the auth routes
 * fail closed instead of minting credentials signed with a guessable key.
 */
export class AuthSecretUnconfiguredError extends Error {
  constructor() {
    super("BETTER_AUTH_SECRET is not configured");
    this.name = "AuthSecretUnconfiguredError";
  }
}

/**
 * Resolve the auth base URL. Cloudflare's D1 binding (and therefore the whole
 * `env`) is per-request, so this — and `makeAuth` — must be called inside a
 * request handler, never at module top level.
 */
export function authBaseURL(env: Env): string {
  return env.BETTER_AUTH_URL ?? `https://${env.API_HOST ?? `api.${env.DOMAIN}`}`;
}

/**
 * Per-request better-auth factory.
 *
 * MUST be called inside a request handler: `env.DB` (and the other bindings) are
 * scoped to a single request in the Workers runtime, so a module-level singleton
 * would capture a stale/again-invalid binding.
 *
 * Database: passes `env.DB` straight through. better-auth's Kysely adapter
 * detects a Cloudflare D1 binding (`batch`/`exec`/`prepare`) and selects its
 * native D1 sqlite dialect — no drizzle, no extra adapter wiring.
 *
 * Email: magic-link delivery goes through the injectable `EmailSender`
 * (default = Cloudflare Email Service via `env.EMAIL.send`). Tests pass a mock.
 */
export function makeAuth(env: Env, opts: MakeAuthOptions = {}): EaslAuth {
  // Fail closed before constructing better-auth. If BETTER_AUTH_SECRET is unset
  // or left at a placeholder/default, better-auth would otherwise silently sign
  // sessions, magic-link tokens, and API keys with its globally-known hardcoded
  // default ("better-auth-secret-12345678901234567890") — its own validateSecret
  // guard only throws when process.env.NODE_ENV === "production", which this
  // Worker never sets. Mirrors isSessionSecretConfigured for v1 unlock cookies.
  if (!isBetterAuthSecretConfigured(env.BETTER_AUTH_SECRET)) {
    throw new AuthSecretUnconfiguredError();
  }

  const emailSender = opts.emailSender ?? makeEmailSender(env);
  const baseURL = authBaseURL(env);

  const options = {
    // D1 binding — Kysely adapter auto-detects the D1 dialect.
    database: env.DB,
    // Guaranteed configured by the fail-closed check above.
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    basePath: AUTH_BASE_PATH,
    // The api host serves /auth/*; the root + wildcard subdomains initiate flows.
    trustedOrigins: [
      baseURL,
      `https://${env.DOMAIN}`,
      `https://*.${env.DOMAIN}`,
    ],
    // v2 uses magic-link only (no email/password); keep it explicitly disabled.
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        sendMagicLink: async ({ email, url }) => {
          await emailSender.send({
            to: email,
            subject: "Your easl sign-in link",
            text: `Sign in to easl:\n\n${url}\n\nThis link expires in 15 minutes. If you didn't request it, you can ignore this email.`,
            html: magicLinkHtml(url),
          });
        },
      }),
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
      }),
    ],
  } satisfies BetterAuthOptions;

  // Cast through the narrow EaslAuth surface — see the EaslAuth doc comment.
  return betterAuth(options) as unknown as EaslAuth;
}

function magicLinkHtml(url: string): string {
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;line-height:1.6">
<p>Sign in to <strong>easl</strong>:</p>
<p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:0.625rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600">Sign in</a></p>
<p style="color:#737373;font-size:0.875rem">This link expires in 15 minutes. If you didn't request it, you can ignore this email.</p>
</body></html>`;
}

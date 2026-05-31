import type { Env } from "../types";

/**
 * better-auth's rate-limit record. Mirrors `@better-auth/core`'s `RateLimit`
 * (the `BaseRateLimit` shape: `{ key, count, lastRequest }`). Declared locally so
 * this module doesn't depend on better-auth's deeply-parameterised types — the
 * adapter is wired into `rateLimit.customStorage` in makeAuth, whose
 * `BetterAuthRateLimitStorage` interface is structurally `{ get, set }` over this
 * record. `lastRequest` is epoch milliseconds (better-auth uses `Date.now()`).
 */
export interface RateLimitRecord {
  key: string;
  count: number;
  lastRequest: number;
}

/** Matches better-auth's `BetterAuthRateLimitStorage` interface (structural). */
export interface RateLimitStorage {
  get(key: string): Promise<RateLimitRecord | null>;
  set(key: string, value: RateLimitRecord, update?: boolean): Promise<void>;
}

/**
 * Namespace prefix for rate-limit keys in KV, so they never collide with the
 * rendered-HTML cache entries that also live in SITES_KV. better-auth's own key
 * is `<ip>:<path>` (see createRateLimitKey); we prefix it.
 */
const KV_KEY_PREFIX = "rl:";

/**
 * KV TTL for a rate-limit bucket, in seconds.
 *
 * better-auth's limiter does the window math itself against `lastRequest`
 * (`shouldRateLimit` / the window-elapsed reset in onResponseRateLimit), so the
 * KV entry only needs to outlive the longest window we enforce — the magic-link
 * rule's 1-hour window (MAGIC_LINK_RATE_LIMIT.window). A longer-lived entry is
 * harmless: once `now - lastRequest > window`, better-auth resets the count to 1
 * on the next request regardless of whether KV has expired the key. We add a
 * margin and clamp to KV's 60s minimum expirationTtl. `customStorage.set` is not
 * handed the per-request window, so this is a fixed ceiling rather than per-rule.
 */
const KV_TTL_SECONDS = 2 * 60 * 60; // 2h — comfortably covers the 1h magic-link window.

/**
 * Rate-limit storage backed by Cloudflare KV, shared across all isolates in a
 * colo. better-auth's default `storage: "memory"` is per-isolate, and Cloudflare
 * runs many isolates per colo, so a memory-backed ~10/hour magic-link cap is
 * effectively multiplied by the number of live isolates (email-bombing risk).
 * Backing the limiter with KV makes the cap global: every isolate reads/writes
 * the same bucket keyed by `<ip>:<path>`.
 *
 * Wired into makeAuth as `rateLimit.customStorage`; better-auth then routes ALL
 * rate-limit reads/writes here (its `getRateLimitStorage` returns customStorage
 * verbatim, bypassing memory/secondary/database storage). This affects only the
 * global IP+path limiter — the api-key plugin's per-key limiter is disabled in
 * makeAuth, so agent/CLI/MCP Bearer publishing stays unthrottled.
 *
 * KV is eventually consistent across colos, so under a distributed flood the cap
 * can briefly overshoot before writes propagate — but it is bounded globally
 * rather than per-isolate, which is the property we need for anti-abuse. Within a
 * single colo (where a flood from one IP lands) reads observe recent writes.
 */
export function makeKvRateLimitStorage(env: Env): RateLimitStorage {
  const kv = env.SITES_KV;
  return {
    async get(key) {
      const raw = await kv.get(`${KV_KEY_PREFIX}${key}`);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as RateLimitRecord;
        // Defensive: a malformed/foreign value must not crash the limiter.
        if (typeof parsed?.count !== "number" || typeof parsed?.lastRequest !== "number") {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    async set(key, value, _update) {
      // expirationTtl floors at 60s in the Workers runtime; KV_TTL_SECONDS is well
      // above that. `update` is irrelevant to KV (put is an upsert either way).
      await kv.put(`${KV_KEY_PREFIX}${key}`, JSON.stringify(value), {
        expirationTtl: KV_TTL_SECONDS,
      });
    },
  };
}

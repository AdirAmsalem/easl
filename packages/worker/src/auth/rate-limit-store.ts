import type { Env } from "../types";

/**
 * better-auth's rate-limit record (its `RateLimit`/`BaseRateLimit` shape), declared
 * locally to avoid depending on better-auth's parameterised types. `lastRequest` is epoch ms.
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
 * KV TTL for a rate-limit bucket. better-auth does the window math itself against
 * `lastRequest`, so the entry only needs to outlive the longest window (the 1h
 * magic-link rule); a longer-lived entry is harmless (the count resets once the window
 * elapses). A fixed ceiling rather than per-rule, since `set` isn't handed the window.
 */
const KV_TTL_SECONDS = 2 * 60 * 60; // 2h — comfortably covers the 1h magic-link window.

/**
 * Rate-limit storage backed by Cloudflare KV, shared across isolates. better-auth's
 * default `storage: "memory"` is per-isolate, so a memory-backed ~10/hour cap is
 * multiplied by the live isolate count (email-bombing risk); KV makes the cap global.
 * Wired into makeAuth as `rateLimit.customStorage`. Caveat: KV is eventually consistent
 * across colos, so a distributed flood can briefly overshoot before writes propagate —
 * bounded globally rather than per-isolate, which is what anti-abuse needs.
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

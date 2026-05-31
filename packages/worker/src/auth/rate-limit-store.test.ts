import { describe, it, expect } from "vitest";
import { makeKvRateLimitStorage, type RateLimitRecord } from "./rate-limit-store";
import type { Env } from "../types";

/**
 * Minimal fake KV that records put options so we can assert TTL wiring and the
 * `rl:` namespace prefix without a real KV binding. Only the methods the adapter
 * uses (get/put) are implemented.
 */
function fakeKv() {
  const store = new Map<string, { value: string; options?: KVNamespacePutOptions }>();
  const puts: { key: string; value: string; options?: KVNamespacePutOptions }[] = [];
  const kv = {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, options?: KVNamespacePutOptions) {
      puts.push({ key, value, options });
      store.set(key, { value, options });
    },
  } as unknown as KVNamespace;
  return { kv, store, puts };
}

function envWithKv(kv: KVNamespace): Env {
  return { SITES_KV: kv } as unknown as Env;
}

const REC: RateLimitRecord = { key: "203.0.113.7:/auth/sign-in/magic-link", count: 3, lastRequest: 1700000000000 };

describe("makeKvRateLimitStorage", () => {
  it("round-trips a record through KV (set then get)", async () => {
    const { kv } = fakeKv();
    const storage = makeKvRateLimitStorage(envWithKv(kv));

    expect(await storage.get(REC.key)).toBeNull(); // empty bucket
    await storage.set(REC.key, REC);
    expect(await storage.get(REC.key)).toEqual(REC);
  });

  it("namespaces keys under `rl:` (no collision with the HTML cache) and sets an expirationTtl", async () => {
    const { kv, puts } = fakeKv();
    const storage = makeKvRateLimitStorage(envWithKv(kv));

    await storage.set(REC.key, REC);
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(`rl:${REC.key}`);
    // TTL must be set so abandoned buckets self-evict, and comfortably exceed the
    // 1-hour magic-link window (and KV's 60s floor).
    const ttl = puts[0].options?.expirationTtl;
    expect(ttl).toBeGreaterThanOrEqual(60 * 60);
  });

  it("returns null for a missing key", async () => {
    const { kv } = fakeKv();
    const storage = makeKvRateLimitStorage(envWithKv(kv));
    expect(await storage.get("nope")).toBeNull();
  });

  it("returns null (does not throw) for a malformed/foreign value in KV", async () => {
    const { kv, store } = fakeKv();
    const storage = makeKvRateLimitStorage(envWithKv(kv));

    // A non-JSON value (e.g. a cached HTML blob under a clashing key) must not crash.
    store.set("rl:bad", { value: "<html>not json</html>" });
    expect(await storage.get("bad")).toBeNull();

    // Well-formed JSON but wrong shape (missing numeric fields) is also rejected.
    store.set("rl:wrong", { value: JSON.stringify({ key: "x", count: "nope" }) });
    expect(await storage.get("wrong")).toBeNull();
  });

  it("upserts on repeated set with the same key (last write wins)", async () => {
    const { kv } = fakeKv();
    const storage = makeKvRateLimitStorage(envWithKv(kv));

    await storage.set(REC.key, { ...REC, count: 1 });
    await storage.set(REC.key, { ...REC, count: 9 }, true);
    expect((await storage.get(REC.key))?.count).toBe(9);
  });
});

import { describe, it, expect } from "vitest";
import type { Env } from "../types";
import { sanitizeNext, sanitizeCliPort } from "./login";

// Only DOMAIN is read by sanitizeNext; cast a minimal stub through Env.
const env = { DOMAIN: "easl.dev" } as unknown as Env;
const apiUrl = "https://api.easl.dev/auth/login";
const fallback = "https://easl.dev/";

describe("sanitizeNext (open-redirect protection for the login page)", () => {
  it("falls back to the apex domain when next is absent", () => {
    expect(sanitizeNext(env, apiUrl, null)).toBe(fallback);
    expect(sanitizeNext(env, apiUrl, undefined)).toBe(fallback);
    expect(sanitizeNext(env, apiUrl, "")).toBe(fallback);
  });

  it("allows a root-relative path", () => {
    expect(sanitizeNext(env, apiUrl, "/s/my-slug")).toBe("/s/my-slug");
    expect(sanitizeNext(env, apiUrl, "/s/my-slug?render=true")).toBe("/s/my-slug?render=true");
  });

  it("rejects protocol-relative and backslash-tricked paths (treats as open redirect)", () => {
    expect(sanitizeNext(env, apiUrl, "//evil.example.com")).toBe(fallback);
    expect(sanitizeNext(env, apiUrl, "/\\evil.example.com")).toBe(fallback);
  });

  it("allows an absolute URL on the apex domain or any subdomain", () => {
    expect(sanitizeNext(env, apiUrl, "https://easl.dev/foo")).toBe("https://easl.dev/foo");
    expect(sanitizeNext(env, apiUrl, "https://my-slug.easl.dev/")).toBe("https://my-slug.easl.dev/");
    // Same-origin as the request (api host) is allowed too.
    expect(sanitizeNext(env, apiUrl, "https://api.easl.dev/auth/login?x=1")).toBe(
      "https://api.easl.dev/auth/login?x=1",
    );
  });

  it("rejects an off-site absolute URL", () => {
    expect(sanitizeNext(env, apiUrl, "https://evil.example.com/phish")).toBe(fallback);
    // A lookalike host that merely ends with the brand but is a different domain.
    expect(sanitizeNext(env, apiUrl, "https://easl.dev.evil.com/")).toBe(fallback);
  });

  it("rejects non-http(s) schemes", () => {
    expect(sanitizeNext(env, apiUrl, "javascript:alert(1)")).toBe(fallback);
    expect(sanitizeNext(env, apiUrl, "data:text/html,<script>1</script>")).toBe(fallback);
  });

  it("allows same-origin path routing (localhost) for local dev / previews", () => {
    const localUrl = "http://localhost:8787/auth/login";
    expect(sanitizeNext(env, localUrl, "http://localhost:8787/s/x")).toBe("http://localhost:8787/s/x");
    // A different localhost port is a different origin and not under DOMAIN → fallback.
    expect(sanitizeNext(env, localUrl, "http://localhost:9999/s/x")).toBe(fallback);
  });
});

describe("sanitizeCliPort (easl login handshake port validation)", () => {
  it("accepts a plausible TCP port and returns its normalized string", () => {
    expect(sanitizeCliPort("51234")).toBe("51234");
    expect(sanitizeCliPort("1")).toBe("1");
    expect(sanitizeCliPort("65535")).toBe("65535");
    // Leading zeros normalize to the numeric value (so the callback URL is canonical).
    expect(sanitizeCliPort("0080")).toBe("80");
  });

  it("rejects absent, non-numeric, out-of-range, or injection-shaped values", () => {
    expect(sanitizeCliPort(null)).toBeNull();
    expect(sanitizeCliPort(undefined)).toBeNull();
    expect(sanitizeCliPort("")).toBeNull();
    expect(sanitizeCliPort("0")).toBeNull();
    expect(sanitizeCliPort("65536")).toBeNull();
    expect(sanitizeCliPort("123456")).toBeNull();
    expect(sanitizeCliPort("80abc")).toBeNull();
    expect(sanitizeCliPort("80/../evil")).toBeNull();
    expect(sanitizeCliPort("-1")).toBeNull();
  });
});

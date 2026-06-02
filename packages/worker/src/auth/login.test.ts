import { describe, it, expect } from "vitest";
import type { Env } from "../types";
import { sanitizeNext, sanitizeCliPort, sanitizeCliState, describeEaslTarget } from "./login";

// Only DOMAIN is read by sanitizeNext; cast a minimal stub through Env.
const env = { DOMAIN: "easl.dev" } as unknown as Env;
// describeEaslTarget also reads API_HOST.
const gateEnv = { DOMAIN: "easl.dev", API_HOST: "api.easl.dev" } as unknown as Env;
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

describe("describeEaslTarget (contextual sign-in copy from the gate `next`)", () => {
  it("returns the host for a private-easl subdomain (subdomain routing)", () => {
    expect(describeEaslTarget(gateEnv, "https://bright-hill-436f.easl.dev/")).toBe(
      "bright-hill-436f.easl.dev",
    );
    // A subpath on the subdomain still reports the host, not the subpath.
    expect(describeEaslTarget(gateEnv, "https://my-slug.easl.dev/s/page")).toBe("my-slug.easl.dev");
  });

  it("returns the slug for path-based routing (apex, local dev, previews)", () => {
    expect(describeEaslTarget(gateEnv, "https://easl.dev/s/my-slug")).toBe("my-slug");
    expect(describeEaslTarget(gateEnv, "/s/my-slug")).toBe("my-slug");
    expect(describeEaslTarget(gateEnv, "/s/my-slug?render=true")).toBe("my-slug");
    expect(describeEaslTarget(gateEnv, "http://localhost:8787/s/my-slug")).toBe("my-slug");
    // Percent-encoded slug is decoded for display.
    expect(describeEaslTarget(gateEnv, "/s/a%20b")).toBe("a b");
  });

  it("returns null for reserved hosts and non-easl targets (generic copy)", () => {
    expect(describeEaslTarget(gateEnv, "https://easl.dev/")).toBeNull();
    expect(describeEaslTarget(gateEnv, "https://www.easl.dev/")).toBeNull();
    expect(describeEaslTarget(gateEnv, "https://api.easl.dev/auth/login")).toBeNull();
    expect(describeEaslTarget(gateEnv, "http://localhost:8787/auth/login")).toBeNull();
  });

  it("returns null when next is absent", () => {
    expect(describeEaslTarget(gateEnv, null)).toBeNull();
    expect(describeEaslTarget(gateEnv, undefined)).toBeNull();
    expect(describeEaslTarget(gateEnv, "")).toBeNull();
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

describe("sanitizeCliState (CLI handshake state nonce validation)", () => {
  it("accepts an opaque URL-safe token of bounded length", () => {
    const ok = "abcDEF012_-abcDEF012"; // 20 chars, base64url-shaped
    expect(sanitizeCliState(ok)).toBe(ok);
    expect(sanitizeCliState("a".repeat(16))).toBe("a".repeat(16));
    expect(sanitizeCliState("Z9_-".repeat(32))).toBe("Z9_-".repeat(32)); // 128 chars
  });

  it("rejects absent, too-short/long, or injection-shaped values", () => {
    expect(sanitizeCliState(null)).toBeNull();
    expect(sanitizeCliState(undefined)).toBeNull();
    expect(sanitizeCliState("")).toBeNull();
    expect(sanitizeCliState("short")).toBeNull(); // < 16
    expect(sanitizeCliState("a".repeat(129))).toBeNull(); // > 128
    // Characters that could break out of the query param / smuggle extra params.
    expect(sanitizeCliState("abcdef0123456789&key=evil")).toBeNull();
    expect(sanitizeCliState("abcdef0123456789/../x")).toBeNull();
    expect(sanitizeCliState("abcdef0123456789 with space")).toBeNull();
  });
});

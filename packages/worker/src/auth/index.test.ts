import { describe, it, expect } from "vitest";
import { bearerApiKeyGetter, API_KEY_PREFIX } from "./index";

// Helper: build a ctx-like object carrying just the headers the getter reads.
function ctx(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

describe("bearerApiKeyGetter", () => {
  const key = `${API_KEY_PREFIX}${"a".repeat(64)}`;

  it("extracts an easl_ key from an Authorization: Bearer header", () => {
    expect(bearerApiKeyGetter(ctx({ Authorization: `Bearer ${key}` }))).toBe(key);
  });

  it("is case-insensitive on the Bearer scheme and tolerates extra whitespace", () => {
    expect(bearerApiKeyGetter(ctx({ Authorization: `bearer   ${key}` }))).toBe(key);
    expect(bearerApiKeyGetter(ctx({ Authorization: `  Bearer ${key}  ` }))).toBe(key);
  });

  it("returns the full token including the prefix (the plugin hashes the whole value)", () => {
    const got = bearerApiKeyGetter(ctx({ Authorization: `Bearer ${key}` }));
    expect(got?.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("ignores bearer tokens that are not easl_ keys (e.g. a stray session token)", () => {
    expect(bearerApiKeyGetter(ctx({ Authorization: "Bearer some-session-jwt-value" }))).toBeNull();
  });

  it("ignores non-Bearer authorization schemes", () => {
    expect(bearerApiKeyGetter(ctx({ Authorization: `Basic ${key}` }))).toBeNull();
  });

  it("returns null when there is no Authorization header", () => {
    expect(bearerApiKeyGetter(ctx({}))).toBeNull();
    expect(bearerApiKeyGetter({ headers: null })).toBeNull();
    expect(bearerApiKeyGetter({})).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  BETTER_AUTH_DEFAULT_SECRET,
  PLACEHOLDER_BETTER_AUTH_SECRET,
  PLACEHOLDER_SESSION_SECRET,
  buildSetCookie,
  isBetterAuthSecretConfigured,
  isSessionSecretConfigured,
  parseCookieHeader,
  passwordFingerprint,
  signCookie,
  signShareToken,
  unlockCookieName,
  verifyCookie,
  verifyShareToken,
} from "./session";

const SECRET = "test-secret-do-not-use-in-prod";
const FP = "fingerprint-a";
const FP2 = "fingerprint-b";

describe("signCookie + verifyCookie", () => {
  it("round-trips for the same slug + fingerprint", async () => {
    const value = await signCookie(SECRET, "slug-abc", FP);
    const result = await verifyCookie(SECRET, "slug-abc", FP, value);
    expect(result.valid).toBe(true);
    expect(result.exp).toBeGreaterThan(Date.now());
  });

  it("rejects a cookie minted for a different slug", async () => {
    const value = await signCookie(SECRET, "slug-abc", FP);
    const result = await verifyCookie(SECRET, "slug-xyz", FP, value);
    expect(result.valid).toBe(false);
  });

  it("rejects a cookie signed with a different secret", async () => {
    const value = await signCookie(SECRET, "slug-abc", FP);
    const result = await verifyCookie("different-secret", "slug-abc", FP, value);
    expect(result.valid).toBe(false);
  });

  it("rejects a cookie whose fingerprint no longer matches (password rotated)", async () => {
    const value = await signCookie(SECRET, "slug-abc", FP);
    const result = await verifyCookie(SECRET, "slug-abc", FP2, value);
    expect(result.valid).toBe(false);
  });

  it("rejects an expired cookie", async () => {
    const value = await signCookie(SECRET, "slug-abc", FP, -1000);
    const result = await verifyCookie(SECRET, "slug-abc", FP, value);
    expect(result.valid).toBe(false);
  });

  it("rejects tampered payloads", async () => {
    const value = await signCookie(SECRET, "slug-abc", FP);
    const [payload, sig] = value.split(".");
    expect(payload && sig).toBeTruthy();
    const tampered = `${payload}A.${sig}`;
    expect((await verifyCookie(SECRET, "slug-abc", FP, tampered)).valid).toBe(false);
  });

  it("rejects malformed input", async () => {
    expect((await verifyCookie(SECRET, "slug-abc", FP, "")).valid).toBe(false);
    expect((await verifyCookie(SECRET, "slug-abc", FP, "no-dot")).valid).toBe(false);
    expect((await verifyCookie(SECRET, "slug-abc", FP, ".onlydot")).valid).toBe(false);
  });
});

describe("signShareToken + verifyShareToken", () => {
  it("round-trips for the same slug and reports its expiry", async () => {
    const { token, exp } = await signShareToken(SECRET, "slug-abc");
    expect(exp).toBeGreaterThan(Date.now());
    const result = await verifyShareToken(SECRET, "slug-abc", token);
    expect(result.valid).toBe(true);
    expect(result.exp).toBe(exp);
  });

  it("uses the b64url(slug|exp).b64url(hmac) shape (two-field payload)", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc");
    const [payload, sig] = token.split(".");
    expect(payload && sig).toBeTruthy();
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded.split("|").length).toBe(2);
    expect(decoded.startsWith("slug-abc|")).toBe(true);
  });

  it("rejects a token minted for a different slug", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc");
    expect((await verifyShareToken(SECRET, "slug-xyz", token)).valid).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc");
    expect((await verifyShareToken("different-secret", "slug-abc", token)).valid).toBe(false);
  });

  it("rejects an expired token", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc", -1000);
    expect((await verifyShareToken(SECRET, "slug-abc", token)).valid).toBe(false);
  });

  it("rejects tampered payloads", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc");
    const [payload, sig] = token.split(".");
    const tampered = `${payload}A.${sig}`;
    expect((await verifyShareToken(SECRET, "slug-abc", tampered)).valid).toBe(false);
  });

  it("rejects malformed input", async () => {
    expect((await verifyShareToken(SECRET, "slug-abc", "")).valid).toBe(false);
    expect((await verifyShareToken(SECRET, "slug-abc", "no-dot")).valid).toBe(false);
    expect((await verifyShareToken(SECRET, "slug-abc", ".onlydot")).valid).toBe(false);
  });

  it("does not validate as an unlock cookie (distinct payload shapes)", async () => {
    // A share token has a 2-field payload; verifyCookie expects 3 fields, so a
    // share token can never be mistaken for an unlock cookie even with the right
    // secret + slug.
    const { token } = await signShareToken(SECRET, "slug-abc");
    expect((await verifyCookie(SECRET, "slug-abc", FP, token)).valid).toBe(false);
  });
});

describe("passwordFingerprint", () => {
  it("is deterministic for the same hash", async () => {
    const a = await passwordFingerprint(SECRET, "hash-1");
    const b = await passwordFingerprint(SECRET, "hash-1");
    expect(a).toBe(b);
  });

  it("changes when the hash changes (rotation invalidation)", async () => {
    const a = await passwordFingerprint(SECRET, "hash-1");
    const b = await passwordFingerprint(SECRET, "hash-2");
    expect(a).not.toBe(b);
  });

  it("round-trips through a cookie so a rotated hash fails verification", async () => {
    const oldFp = await passwordFingerprint(SECRET, "old-hash");
    const newFp = await passwordFingerprint(SECRET, "new-hash");
    const cookie = await signCookie(SECRET, "slug-abc", oldFp);
    expect((await verifyCookie(SECRET, "slug-abc", oldFp, cookie)).valid).toBe(true);
    expect((await verifyCookie(SECRET, "slug-abc", newFp, cookie)).valid).toBe(false);
  });
});

describe("isSessionSecretConfigured", () => {
  it("rejects unset, short, and placeholder secrets", () => {
    expect(isSessionSecretConfigured(undefined)).toBe(false);
    expect(isSessionSecretConfigured(null)).toBe(false);
    expect(isSessionSecretConfigured("")).toBe(false);
    expect(isSessionSecretConfigured("too-short")).toBe(false);
    expect(isSessionSecretConfigured(PLACEHOLDER_SESSION_SECRET)).toBe(false);
  });

  it("accepts a real long secret", () => {
    expect(isSessionSecretConfigured("a-genuinely-long-random-secret-value")).toBe(true);
  });
});

describe("isBetterAuthSecretConfigured", () => {
  it("rejects unset, short, placeholder, and better-auth's default secret", () => {
    expect(isBetterAuthSecretConfigured(undefined)).toBe(false);
    expect(isBetterAuthSecretConfigured(null)).toBe(false);
    expect(isBetterAuthSecretConfigured("")).toBe(false);
    // 31 chars — one below the 32-char minimum.
    expect(isBetterAuthSecretConfigured("a".repeat(31))).toBe(false);
    expect(isBetterAuthSecretConfigured(PLACEHOLDER_BETTER_AUTH_SECRET)).toBe(false);
    // better-auth's globally-known hardcoded fallback must be rejected even though
    // it is long enough, since better-auth boots with it when the secret is unset.
    expect(isBetterAuthSecretConfigured(BETTER_AUTH_DEFAULT_SECRET)).toBe(false);
  });

  it("accepts a real secret of at least 32 chars", () => {
    expect(isBetterAuthSecretConfigured("a".repeat(32))).toBe(true);
    expect(isBetterAuthSecretConfigured("a-genuinely-long-random-better-auth-secret-value")).toBe(true);
  });
});

describe("parseCookieHeader", () => {
  it("returns null for missing header", () => {
    expect(parseCookieHeader(null, "easl_pk_abc")).toBe(null);
  });

  it("extracts a named cookie from a multi-cookie header", () => {
    const header = "foo=1; easl_pk_abc=signedvalue; bar=2";
    expect(parseCookieHeader(header, "easl_pk_abc")).toBe("signedvalue");
  });

  it("returns null when the named cookie is absent", () => {
    expect(parseCookieHeader("foo=1; bar=2", "easl_pk_abc")).toBe(null);
  });
});

describe("buildSetCookie", () => {
  it("includes secure defaults", () => {
    const header = buildSetCookie("easl_pk_abc", "val");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toMatch(/Max-Age=\d+/);
  });

  it("respects custom path and domain", () => {
    const header = buildSetCookie("easl_pk_abc", "val", { path: "/s/abc", domain: "easl.dev" });
    expect(header).toContain("Path=/s/abc");
    expect(header).toContain("Domain=easl.dev");
  });
});

describe("unlockCookieName", () => {
  it("namespaces by slug", () => {
    expect(unlockCookieName("abc-def")).toBe("easl_pk_abc-def");
  });
});

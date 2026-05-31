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
  shareCookieName,
  shareFingerprint,
  signCliCallbackMarker,
  signCookie,
  signShareCookie,
  signShareToken,
  unlockCookieName,
  verifyCliCallbackMarker,
  verifyCookie,
  verifyShareCookie,
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
  it("round-trips for the same slug + fingerprint and reports its expiry", async () => {
    const { token, exp } = await signShareToken(SECRET, "slug-abc", FP);
    expect(exp).toBeGreaterThan(Date.now());
    const result = await verifyShareToken(SECRET, "slug-abc", FP, token);
    expect(result.valid).toBe(true);
    expect(result.exp).toBe(exp);
  });

  it("uses the b64url(slug|exp|fingerprint).b64url(hmac) shape (three-field payload)", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc", FP);
    const [payload, sig] = token.split(".");
    expect(payload && sig).toBeTruthy();
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded.split("|").length).toBe(3);
    expect(decoded.startsWith("slug-abc|")).toBe(true);
    expect(decoded.endsWith(`|${FP}`)).toBe(true);
  });

  it("rejects a token minted for a different slug", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc", FP);
    expect((await verifyShareToken(SECRET, "slug-xyz", FP, token)).valid).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc", FP);
    expect((await verifyShareToken("different-secret", "slug-abc", FP, token)).valid).toBe(false);
  });

  it("rejects a token whose fingerprint no longer matches (slug re-published as a new instance)", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc", FP);
    expect((await verifyShareToken(SECRET, "slug-abc", FP2, token)).valid).toBe(false);
  });

  it("rejects an expired token", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc", FP, -1000);
    expect((await verifyShareToken(SECRET, "slug-abc", FP, token)).valid).toBe(false);
  });

  it("rejects tampered payloads", async () => {
    const { token } = await signShareToken(SECRET, "slug-abc", FP);
    const [payload, sig] = token.split(".");
    const tampered = `${payload}A.${sig}`;
    expect((await verifyShareToken(SECRET, "slug-abc", FP, tampered)).valid).toBe(false);
  });

  it("rejects malformed input", async () => {
    expect((await verifyShareToken(SECRET, "slug-abc", FP, "")).valid).toBe(false);
    expect((await verifyShareToken(SECRET, "slug-abc", FP, "no-dot")).valid).toBe(false);
    expect((await verifyShareToken(SECRET, "slug-abc", FP, ".onlydot")).valid).toBe(false);
  });
});

describe("shareFingerprint", () => {
  const SITE = { createdAt: "2025-01-01T00:00:00Z", ownerId: "owner-1" };

  it("is deterministic for the same instance", async () => {
    const a = await shareFingerprint(SECRET, SITE);
    const b = await shareFingerprint(SECRET, { ...SITE });
    expect(a).toBe(b);
  });

  it("changes when created_at changes (delete + re-publish under the same slug)", async () => {
    const a = await shareFingerprint(SECRET, SITE);
    const b = await shareFingerprint(SECRET, { ...SITE, createdAt: "2025-06-01T00:00:00Z" });
    expect(a).not.toBe(b);
  });

  it("changes when owner_id changes", async () => {
    const a = await shareFingerprint(SECRET, SITE);
    const b = await shareFingerprint(SECRET, { ...SITE, ownerId: "owner-2" });
    expect(a).not.toBe(b);
  });

  it("treats a null owner distinctly", async () => {
    const a = await shareFingerprint(SECRET, { createdAt: SITE.createdAt, ownerId: null });
    const b = await shareFingerprint(SECRET, { createdAt: SITE.createdAt, ownerId: "owner-1" });
    expect(a).not.toBe(b);
  });

  it("round-trips through a share token so a re-published instance fails verification", async () => {
    const oldFp = await shareFingerprint(SECRET, SITE);
    const newFp = await shareFingerprint(SECRET, { ...SITE, createdAt: "2025-09-09T00:00:00Z" });
    const { token } = await signShareToken(SECRET, "slug-abc", oldFp);
    expect((await verifyShareToken(SECRET, "slug-abc", oldFp, token)).valid).toBe(true);
    expect((await verifyShareToken(SECRET, "slug-abc", newFp, token)).valid).toBe(false);
  });
});

describe("signShareCookie + verifyShareCookie", () => {
  const TTL = 60 * 60 * 1000;

  it("round-trips for the same slug + fingerprint", async () => {
    const value = await signShareCookie(SECRET, "slug-abc", FP, TTL);
    const result = await verifyShareCookie(SECRET, "slug-abc", FP, value);
    expect(result.valid).toBe(true);
    expect(result.exp).toBeGreaterThan(Date.now());
  });

  it("rejects a cookie for a different slug, fingerprint, or secret", async () => {
    const value = await signShareCookie(SECRET, "slug-abc", FP, TTL);
    expect((await verifyShareCookie(SECRET, "slug-xyz", FP, value)).valid).toBe(false);
    expect((await verifyShareCookie(SECRET, "slug-abc", FP2, value)).valid).toBe(false);
    expect((await verifyShareCookie("different-secret", "slug-abc", FP, value)).valid).toBe(false);
  });

  it("rejects an expired cookie", async () => {
    const value = await signShareCookie(SECRET, "slug-abc", FP, -1000);
    expect((await verifyShareCookie(SECRET, "slug-abc", FP, value)).valid).toBe(false);
  });

  it("a share cookie and a share token of the same instance interchangeably verify (shared shape)", async () => {
    // The two are the same payload shape by design — a share cookie is just a
    // share token persisted in a cookie. The point is the fingerprint binding.
    const cookie = await signShareCookie(SECRET, "slug-abc", FP, TTL);
    expect((await verifyShareToken(SECRET, "slug-abc", FP, cookie)).valid).toBe(true);
  });
});

describe("shareCookieName", () => {
  it("namespaces by slug and is distinct from the unlock cookie", () => {
    expect(shareCookieName("abc-def")).toBe("easl_sh_abc-def");
    expect(shareCookieName("abc-def")).not.toBe(unlockCookieName("abc-def"));
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

describe("signCliCallbackMarker + verifyCliCallbackMarker", () => {
  it("round-trips for the same port and yields a single-use nonce", async () => {
    const { marker, nonce, exp } = await signCliCallbackMarker(SECRET, "51234");
    expect(nonce).toBeTruthy();
    expect(exp).toBeGreaterThan(Date.now());
    const result = await verifyCliCallbackMarker(SECRET, "51234", marker);
    expect(result.valid).toBe(true);
    expect(result.nonce).toBe(nonce);
  });

  it("rejects a marker bound to a different port (no cross-handshake replay)", async () => {
    const { marker } = await signCliCallbackMarker(SECRET, "51234");
    const result = await verifyCliCallbackMarker(SECRET, "49999", marker);
    expect(result.valid).toBe(false);
  });

  it("rejects a marker signed with a different secret (forgery)", async () => {
    const { marker } = await signCliCallbackMarker(SECRET, "51234");
    const result = await verifyCliCallbackMarker("a-different-secret", "51234", marker);
    expect(result.valid).toBe(false);
  });

  it("rejects an expired marker", async () => {
    const { marker } = await signCliCallbackMarker(SECRET, "51234", -1000);
    const result = await verifyCliCallbackMarker(SECRET, "51234", marker);
    expect(result.valid).toBe(false);
  });

  it("rejects garbage / tampered marker shapes", async () => {
    expect((await verifyCliCallbackMarker(SECRET, "51234", "")).valid).toBe(false);
    expect((await verifyCliCallbackMarker(SECRET, "51234", "nodot")).valid).toBe(false);
    expect((await verifyCliCallbackMarker(SECRET, "51234", "a.b.c")).valid).toBe(false);
    const { marker } = await signCliCallbackMarker(SECRET, "51234");
    // Flip the signature half → no longer verifies.
    const [payload] = marker.split(".");
    expect((await verifyCliCallbackMarker(SECRET, "51234", `${payload}.deadbeef`)).valid).toBe(false);
  });

  it("issues a distinct nonce + marker on each call (markers are not deterministic)", async () => {
    const a = await signCliCallbackMarker(SECRET, "51234");
    const b = await signCliCallbackMarker(SECRET, "51234");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.marker).not.toBe(b.marker);
  });
});

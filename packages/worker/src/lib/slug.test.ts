import { describe, it, expect } from "vitest";
import { generateSlug, generateVersionId, generateClaimToken, isValidCustomSlug } from "./slug";

describe("generateSlug", () => {
  it("returns adjective-noun-hex format", () => {
    const slug = generateSlug();
    const parts = slug.split("-");
    expect(parts.length).toBe(3);
    expect(parts[2]).toMatch(/^[0-9a-f]{4}$/);
  });

  it("generates unique slugs", () => {
    const slugs = new Set(Array.from({ length: 50 }, () => generateSlug()));
    expect(slugs.size).toBe(50);
  });

  it("uses only lowercase characters", () => {
    const slug = generateSlug();
    expect(slug).toBe(slug.toLowerCase());
  });
});

describe("generateVersionId", () => {
  it("starts with v_ prefix", () => {
    const id = generateVersionId();
    expect(id.startsWith("v_")).toBe(true);
  });

  it("contains time and random parts", () => {
    const id = generateVersionId();
    const parts = id.split("_");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe("v");
    expect(parts[1].length).toBe(9); // base36 timestamp
    expect(parts[2]).toMatch(/^[0-9a-f]{6}$/);
  });

  it("generates unique version IDs", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateVersionId()));
    expect(ids.size).toBe(50);
  });
});

describe("generateClaimToken", () => {
  it("returns 32-char hex string (128-bit)", () => {
    const token = generateClaimToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateClaimToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("isValidCustomSlug", () => {
  it("accepts valid slugs", () => {
    expect(isValidCustomSlug("my-cool-site")).toBe(true);
    expect(isValidCustomSlug("abc")).toBe(true);
    expect(isValidCustomSlug("a1b2c3")).toBe(true);
    expect(isValidCustomSlug("my-project-2026")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidCustomSlug("")).toBe(false);
  });

  it("rejects single character", () => {
    expect(isValidCustomSlug("a")).toBe(false);
  });

  it("rejects slugs starting with hyphen", () => {
    expect(isValidCustomSlug("-my-site")).toBe(false);
  });

  it("rejects slugs ending with hyphen", () => {
    expect(isValidCustomSlug("my-site-")).toBe(false);
  });

  it("rejects double hyphens", () => {
    expect(isValidCustomSlug("my--site")).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(isValidCustomSlug("My-Site")).toBe(false);
  });

  it("rejects slugs over 48 chars", () => {
    expect(isValidCustomSlug("a".repeat(49))).toBe(false);
  });

  it("accepts 48 char slug", () => {
    expect(isValidCustomSlug("a".repeat(48))).toBe(true);
  });

  it("rejects special characters", () => {
    expect(isValidCustomSlug("my_site")).toBe(false);
    expect(isValidCustomSlug("my.site")).toBe(false);
    expect(isValidCustomSlug("my site")).toBe(false);
  });
});

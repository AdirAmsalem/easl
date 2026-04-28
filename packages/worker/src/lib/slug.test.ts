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

  it("derives slug from title when provided", () => {
    expect(generateSlug("Q1 Budget Report")).toMatch(/^q1-budget-report-[0-9a-f]{4}$/);
  });

  it("truncates long titles and stays within length cap", () => {
    const slug = generateSlug("a".repeat(200));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).toMatch(/^a+-[0-9a-f]{4}$/);
    expect(isValidCustomSlug(slug)).toBe(true);
  });

  it("falls back to adjective-noun when title slugifies to empty", () => {
    for (const title of ["", "   ", "!!!", null, undefined]) {
      const slug = generateSlug(title);
      expect(slug.split("-").length).toBe(3);
      expect(slug).toMatch(/-[0-9a-f]{4}$/);
    }
  });

  it("falls back when title would collide with reserved preview- prefix", () => {
    for (const title of ["preview", "Preview", "Preview release", "preview-pr-4"]) {
      const slug = generateSlug(title);
      expect(slug.startsWith("preview-")).toBe(false);
      expect(slug).not.toBe("preview");
    }
  });

  it("always produces a slug that passes isValidCustomSlug", () => {
    const titles = [
      undefined, null, "", "   ", "!!!",
      "a", "Q1 Budget Report", "Café Menu", "preview", "Preview release",
      "a".repeat(200), "---", "  Hello, World!  ", "2026", "✨ launch ✨",
    ];
    for (const title of titles) {
      const slug = generateSlug(title);
      expect(isValidCustomSlug(slug)).toBe(true);
    }
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
    expect(parts[2]).toMatch(/^[0-9a-f]{8}$/);
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

  it("rejects preview- prefix (reserved for deploy previews)", () => {
    expect(isValidCustomSlug("preview-pr-4")).toBe(false);
    expect(isValidCustomSlug("preview-test")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(isValidCustomSlug("my_site")).toBe(false);
    expect(isValidCustomSlug("my.site")).toBe(false);
    expect(isValidCustomSlug("my site")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { generatePassword, hashPassword, verifyPassword } from "./password";

describe("hashPassword + verifyPassword", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("emits hashes in pbkdf2$iters$salt$hash format", async () => {
    const hash = await hashPassword("anything");
    expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it("produces a different salt each time (so hashes differ for same password)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$abc$salt$hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$10$salt$hash")).toBe(false);
  });
});

describe("generatePassword", () => {
  it("returns a 5-segment hyphenated string", () => {
    const pw = generatePassword();
    const parts = pw.split("-");
    expect(parts.length).toBe(5);
    expect(parts[4]).toMatch(/^\d{4}$/);
  });

  it("uses only lowercase letters and digits", () => {
    const pw = generatePassword();
    expect(pw).toMatch(/^[a-z0-9-]+$/);
  });

  it("generates distinct values", () => {
    const pws = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(pws.size).toBeGreaterThan(45);
  });
});

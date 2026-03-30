import { describe, it, expect, vi } from "vitest";
import app from "./feedback";

const run = vi.fn(async () => ({}));
const bind = vi.fn((..._args: unknown[]) => ({ run }));
const prepare = vi.fn(() => ({ bind }));

function post(body?: unknown, contentType = "application/json") {
  const init: RequestInit = { method: "POST", headers: { "Content-Type": contentType } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request("/feedback", init, { DB: { prepare } } as never);
}

describe("POST /feedback", () => {
  it("inserts valid feedback and returns 201", async () => {
    const res = await post({ message: "Great tool!", email: "a@b.com", name: "Alice", metadata: { slug: "warm-dawn" } });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { success: boolean; id: string };
    expect(json.success).toBe(true);
    expect(json.id).toBeDefined();

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO feedback"));
    const boundArgs = bind.mock.lastCall!;
    expect(boundArgs[1]).toBe("Great tool!");
    expect(boundArgs[2]).toBe("a@b.com");
    expect(boundArgs[3]).toBe("Alice");
    expect(boundArgs[4]).toBe(JSON.stringify({ slug: "warm-dawn" }));
  });

  it("accepts message-only body", async () => {
    const res = await post({ message: "Just a note" });
    expect(res.status).toBe(201);
    const boundArgs = bind.mock.lastCall!;
    expect(boundArgs[2]).toBeNull();
    expect(boundArgs[3]).toBeNull();
    expect(boundArgs[4]).toBeNull();
  });

  it("rejects non-JSON body", async () => {
    const res = await app.request("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }, { DB: { prepare } } as never);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Invalid JSON body");
  });

  it("rejects null body", async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
  });

  it("rejects missing message", async () => {
    const res = await post({ email: "a@b.com" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("message is required");
  });

  it("rejects non-string message", async () => {
    const res = await post({ message: 42 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("message is required");
  });

  it("rejects message over 10KB", async () => {
    const res = await post({ message: "x".repeat(10_241) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("10KB");
  });

  it("rejects email over 320 chars", async () => {
    const res = await post({ message: "hi", email: "a".repeat(321) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("email");
  });

  it("rejects name over 200 chars", async () => {
    const res = await post({ message: "hi", name: "a".repeat(201) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("name");
  });

  it("rejects metadata over 10KB", async () => {
    const res = await post({ message: "hi", metadata: { big: "x".repeat(10_240) } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("metadata");
  });
});

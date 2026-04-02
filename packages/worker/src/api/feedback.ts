import { Hono } from "hono";
import type { Env } from "../types";
import { generateVersionId } from "../lib/slug";

const app = new Hono<{ Bindings: Env }>();

// POST /feedback
app.post("/feedback", async (c) => {
  let body: { message: string; email?: string; name?: string; metadata?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required" }, 400);
  }

  if (body.message.length > 10_240) {
    return c.json({ error: "message exceeds 10KB limit" }, 400);
  }

  if (body.email && body.email.length > 320) {
    return c.json({ error: "email exceeds 320 char limit" }, 400);
  }

  if (body.name && body.name.length > 200) {
    return c.json({ error: "name exceeds 200 char limit" }, 400);
  }

  const metadataJson = body.metadata ? JSON.stringify(body.metadata) : null;
  if (metadataJson && metadataJson.length > 10_240) {
    return c.json({ error: "metadata exceeds 10KB limit" }, 400);
  }

  const id = generateVersionId();

  await c.env.DB.prepare(
    `INSERT INTO feedback (id, message, email, name, metadata) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, body.message, body.email ?? null, body.name ?? null, metadataJson).run();

  console.log(JSON.stringify({ event: "feedback", hasEmail: !!body.email }));

  return c.json({ success: true, id }, 201);
});

export default app;

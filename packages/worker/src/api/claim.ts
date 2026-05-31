import { Hono } from "hono";
import type { Env, SiteRow } from "../types";
import { constantTimeEqual } from "../lib/crypto";
import { generateClaimToken } from "../lib/slug";
import { requireUser } from "../auth/middleware";

const app = new Hono<{ Bindings: Env }>();

// POST /sites/:slug/claim — Adopt an anonymous site into the caller's account.
//   Authenticated (session cookie OR Bearer key). Body: { claimToken }.
//   If the token matches the site's claim_token, sets owner_id = user.id and flips
//   is_anonymous off. Powers `easl claim <slug>`.
app.post("/sites/:slug/claim", async (c) => {
  const slug = c.req.param("slug");

  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  let body: { claimToken?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body.claimToken !== "string" || body.claimToken.length === 0) {
    return c.json({ error: "`claimToken` is required" }, 400);
  }

  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE slug = ?")
    .bind(slug).first<SiteRow>();
  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  // Already owned by this caller → idempotent success (still verifies the token,
  // so a wrong token can't no-op into a "claimed" response).
  if (!constantTimeEqual(site.claim_token, body.claimToken)) {
    return c.json({ error: "Invalid claim token" }, 403);
  }

  // Refuse to steal a site already owned by a DIFFERENT account.
  if (site.owner_id && site.owner_id !== user.id) {
    return c.json({ error: "Site is already owned by another account" }, 409);
  }

  // Adopt the site AND rotate the claim token. The old token was returned by
  // /publish and is commonly persisted in CLI config / shared; leaving it intact
  // would keep a parallel, un-revocable credential alive even though the site is
  // now account-owned. Rotating it (combined with authorizeSiteMutation refusing
  // the claim-token path on owned sites) ensures the only mutation credential for
  // an adopted site is the owner's session/Bearer key.
  const rotatedClaimToken = generateClaimToken();
  await c.env.DB.prepare(
    "UPDATE sites SET owner_id = ?, is_anonymous = 0, claim_token = ? WHERE slug = ?"
  ).bind(user.id, rotatedClaimToken, slug).run();

  console.log(JSON.stringify({ event: "site_claimed", slug }));

  return c.json({ success: true, slug, owned: true });
});

export default app;

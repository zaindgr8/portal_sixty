import { guard, handle, json, fail } from "@/lib/proptech/access";
import { audit, getListing, listPortalListings, setPortalListing, updateListing } from "@/lib/proptech/store";
import { validateFor } from "@/lib/proptech/publish";
import { loadBundle } from "@/lib/proptech/server";
import { forgetFeed } from "@/lib/proptech/adapters/bayut";
import { MANUAL_PREFIX, isManual } from "@/lib/proptech/manual";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

// The agent posted the listing themselves (copy & paste): record it so status, audit and the list stay right.
// The same checks as automatic publishing apply first: valid permit, required fields, photos.
export const POST = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const l = await getListing(c.ws.id, id);
  if (!l) return fail("Listing not found.", 404);
  const b = (await req.json().catch(() => ({}))) as { portal?: string; reference?: string; action?: string };
  const portal = b.portal === "propertyfinder" || b.portal === "bayut" ? b.portal : null;
  if (!portal) return fail("Pick Property Finder or Bayut.");
  if (b.action === "removed") {
    const cur = (await listPortalListings(c.ws.id, id)).find((p) => p.portal === portal);
    if (!cur || !isManual(cur.externalId)) return fail("This listing wasn't posted by hand on that portal.");
    await setPortalListing(c.ws.id, id, portal, { status: "unpublished" });
    await audit(c.ws.id, id, c.user.username, "unpublish", { portals: [portal], manual: true });
  } else {
    const v = await validateFor(c.ws.id, l, [portal]);
    if (!v.ok) return fail("Fix these before posting.", 422, { issues: v.issues });
    const ref = String(b.reference ?? "").trim().slice(0, 300);
    await setPortalListing(c.ws.id, id, portal, { status: "live", externalId: `${MANUAL_PREFIX}${ref || "posted"}`, lastError: null });
    if (l.status !== "published") await updateListing(c.ws.id, id, { status: "published", approved_at: new Date().toISOString(), approved_by: c.user.username });
    await audit(c.ws.id, id, c.user.username, "publish", { portals: [portal], manual: true, reference: ref || null });
  }
  if (portal === "bayut") forgetFeed(c.ws.id);
  return json(await loadBundle(c, id));
});

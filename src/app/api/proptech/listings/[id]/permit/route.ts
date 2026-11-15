import { guard, handle, json, fail } from "@/lib/proptech/access";
import { audit, getListing, getListingRow, maskOwner, readOwner, toListing, updateListing } from "@/lib/proptech/store";
import { permitBlock } from "@/lib/proptech/server";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

// "Copy permit application data". Owner details are only unmasked for agency admins.
export const GET = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const row = await getListingRow(c.ws.id, (await params).id);
  if (!row) return fail("Listing not found.", 404);
  const owner = readOwner(row);
  return json({ text: permitBlock(toListing(row), c.admin ? owner : maskOwner(owner), c.ws.name) });
});

// Compliance tracking: "I've applied on Trakheesi" (or undo). The permit itself is entered on the listing.
export const POST = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  if (!(await getListing(c.ws.id, id))) return fail("Listing not found.", 404);
  const b = (await req.json().catch(() => ({}))) as { applied?: boolean };
  const applied = b.applied !== false;
  await updateListing(c.ws.id, id, { permit_applied_at: applied ? new Date().toISOString() : null });
  await audit(c.ws.id, id, c.user.username, applied ? "permit_applied" : "permit_applied_undo");
  return json({ ok: true });
});

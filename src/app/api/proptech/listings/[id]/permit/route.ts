import { guard, handle, json, fail } from "@/lib/proptech/access";
import { getListingRow, maskOwner, readOwner, toListing } from "@/lib/proptech/store";
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

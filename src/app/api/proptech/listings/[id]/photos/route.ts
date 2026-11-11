import { guard, handle, fail } from "@/lib/proptech/access";
import { getListingRow, listMediaRows } from "@/lib/proptech/store";
import { getObject } from "@/lib/proptech/storage";
import { extFor } from "@/lib/proptech/files";
import { zipStore } from "@/lib/proptech/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type P = { params: Promise<{ id: string }> };

// Every photo of a listing as one zip, cover first, in the listing's order (01-cover.jpg, 02-living-room.jpg…).
export const GET = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const row = await getListingRow(c.ws.id, id);
  if (!row) return fail("Listing not found.", 404);
  const photos = (await listMediaRows(c.ws.id, id))
    .filter((m) => m.kind === "photo" && !m.removed)
    .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || Number(a.sort_order) - Number(b.sort_order));
  if (!photos.length) return fail("This listing has no photos.", 404);
  const files = await Promise.all(photos.map(async (m, i) => ({
    name: `${String(i + 1).padStart(2, "0")}-${m.is_cover ? "cover" : String(m.room_type ?? "photo").replace(/[^a-z0-9]+/gi, "-")}.${extFor(String(m.mime_type))}`,
    data: new Uint8Array(await getObject(c.ws.id, String(m.path))),
  })));
  const name = `${String(row.building || row.community || "listing").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}-photos.zip`;
  return new Response(zipStore(files) as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
});

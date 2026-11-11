import { guard, handle, json, fail } from "@/lib/proptech/access";
import { addMedia, audit, createListing, getInputs, getListingRow, listMediaRows, updateInputs } from "@/lib/proptech/store";
import { getObject, objectPath, putObject } from "@/lib/proptech/storage";
import { extFor } from "@/lib/proptech/files";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type P = { params: Promise<{ id: string }> };

// Copy a listing (e.g. the same unit for rent as well as sale). The permit is NOT copied: each ad needs its own.
const SKIP = new Set(["id", "workspace_id", "created_by", "status", "created_at", "updated_at", "approved_at", "approved_by", "permit_number", "permit_expiry", "ai_cost_usd", "ai_tokens", "progress"]);

export const POST = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const row = await getListingRow(c.ws.id, id);
  if (!row) return fail("Listing not found.", 404);
  const copy = Object.fromEntries(Object.entries(row).filter(([k]) => !SKIP.has(k)));
  const l = await createListing(c.ws.id, c.user.username, { ...copy, status: "review", title_en: row.title_en ? `${row.title_en}`.slice(0, 50) : null });
  const inputs = await getInputs(c.ws.id, id);
  await updateInputs(c.ws.id, l.id, { agent_notes: inputs.agent_notes ?? "", voice_transcript: inputs.voice_transcript ?? "" });
  for (const m of (await listMediaRows(c.ws.id, id)).filter((x) => !x.removed)) {
    const path = objectPath(c.ws.id, l.id, extFor(String(m.mime_type)));
    await putObject(c.ws.id, path, await getObject(c.ws.id, String(m.path)), String(m.mime_type));
    const { id: _i, listing_id: _l, created_at: _c, path: _p, workspace_id: _w, ...rest } = m;
    void _i; void _l; void _c; void _p; void _w;
    await addMedia(c.ws.id, l.id, { ...rest, path });
  }
  await audit(c.ws.id, l.id, c.user.username, "duplicate", { from: id });
  return json({ id: l.id }, 201);
});

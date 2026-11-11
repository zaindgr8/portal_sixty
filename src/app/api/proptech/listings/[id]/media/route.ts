import sharp from "sharp";
import { guard, handle, json, fail } from "@/lib/proptech/access";
import { checkUpload, extFor, MAX_PHOTOS, type UploadKind } from "@/lib/proptech/files";
import { addMedia, deleteMedia, getListing, listMediaRows, toMedia, updateMedia } from "@/lib/proptech/store";
import { objectPath, putObject, removeObjects, signUrl } from "@/lib/proptech/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type P = { params: Promise<{ id: string }> };
const KINDS: UploadKind[] = ["form_a", "photo", "document", "floorplan", "audio"];

// One file per request (the wizard uploads several at once, each with its own progress bar).
export const POST = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const l = await getListing(c.ws.id, id);
  if (!l) return fail("Listing not found.", 404);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "") as UploadKind;
  if (!(file instanceof File)) return fail("Choose a file to upload.");
  if (!KINDS.includes(kind)) return fail("Unknown upload type.");
  const buf = Buffer.from(await file.arrayBuffer());
  const chk = checkUpload(kind, file.name, buf.length, buf.subarray(0, 32));
  if ("error" in chk) return fail(chk.error);

  const existing = (await listMediaRows(c.ws.id, id)).filter((m) => !m.removed);
  if (kind === "photo" && existing.filter((m) => m.kind === "photo").length >= MAX_PHOTOS) return fail(`Up to ${MAX_PHOTOS} photos per listing.`);
  if (kind === "audio" && existing.some((m) => m.kind === "audio")) {
    const old = existing.filter((m) => m.kind === "audio");
    await removeObjects(c.ws.id, old.map((m) => String(m.path)));
    await Promise.all(old.map((m) => deleteMedia(c.ws.id, id, String(m.id))));
  }

  let width: number | null = null, height: number | null = null;
  if (chk.mime.startsWith("image/")) {
    try {
      const meta = await sharp(buf).metadata();
      const swap = (meta.orientation ?? 1) >= 5;
      width = (swap ? meta.height : meta.width) ?? null;
      height = (swap ? meta.width : meta.height) ?? null;
    } catch { /* HEIC isn't readable by sharp here; Gemini still reads it */ }
  }
  const path = objectPath(c.ws.id, id, extFor(chk.mime));
  await putObject(c.ws.id, path, buf, chk.mime);
  const docType = kind === "document" ? String(form?.get("docType") ?? "other").replace(/[^a-z_]/g, "").slice(0, 20) : null;
  const order = existing.filter((m) => m.kind === kind).length;
  const row = await addMedia(c.ws.id, id, {
    path, kind, doc_type: docType, file_name: file.name.slice(0, 160), mime_type: chk.mime, size_bytes: buf.length, width, height,
    sort_order: order, is_cover: kind === "photo" && !existing.some((m) => m.kind === "photo"),
    flags: width && height && Math.min(width, height) < 800 ? { low_res: true } : {},
  });
  // Photos upload in parallel, so several can think they're first: keep only the oldest cover.
  let media = toMedia(row);
  if (kind === "photo" && row.is_cover) {
    const covers = (await listMediaRows(c.ws.id, id)).filter((m) => m.kind === "photo" && m.is_cover && !m.removed)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
    for (const extra of covers.slice(1)) await updateMedia(c.ws.id, id, String(extra.id), { is_cover: false });
    if (covers[0] && covers[0].id !== row.id) media = { ...media, isCover: false };
  }
  return json({ media: { ...media, url: await signUrl(c.ws.id, path) } }, 201);
});

// Photo manager: reorder, set cover, remove / restore, set room type.
export const PATCH = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  if (!(await getListing(c.ws.id, id))) return fail("Listing not found.", 404);
  const b = (await req.json().catch(() => ({}))) as { order?: string[]; cover?: string; remove?: string; restore?: string; roomType?: { id: string; value: string } };
  const rows = await listMediaRows(c.ws.id, id);
  const mine = new Set(rows.map((r) => String(r.id)));
  if (b.order) await Promise.all(b.order.filter((m) => mine.has(m)).map((m, i) => updateMedia(c.ws.id, id, m, { sort_order: i })));
  if (b.cover && mine.has(b.cover)) {
    await Promise.all(rows.filter((r) => r.kind === "photo").map((r) => updateMedia(c.ws.id, id, String(r.id), { is_cover: r.id === b.cover })));
  }
  if (b.remove && mine.has(b.remove)) {
    const r = rows.find((x) => x.id === b.remove)!;
    await updateMedia(c.ws.id, id, b.remove, { removed: true, is_cover: false });
    if (r.is_cover) {
      const next = rows.filter((x) => x.kind === "photo" && !x.removed && x.id !== b.remove).sort((a, z) => Number(a.sort_order) - Number(z.sort_order))[0];
      if (next) await updateMedia(c.ws.id, id, String(next.id), { is_cover: true });
    }
  }
  if (b.restore && mine.has(b.restore)) await updateMedia(c.ws.id, id, b.restore, { removed: false });
  if (b.roomType && mine.has(b.roomType.id)) await updateMedia(c.ws.id, id, b.roomType.id, { room_type: String(b.roomType.value).slice(0, 30) });
  return json({ ok: true });
});

// Delete an upload outright (wizard, before processing).
export const DELETE = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const mediaId = new URL(req.url).searchParams.get("mediaId") ?? "";
  const row = await deleteMedia(c.ws.id, id, mediaId);
  if (!row) return fail("File not found.", 404);
  await removeObjects(c.ws.id, [String(row.path)]);
  return json({ ok: true });
});

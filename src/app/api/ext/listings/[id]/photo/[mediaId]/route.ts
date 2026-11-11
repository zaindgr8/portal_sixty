import { extGuard } from "@/lib/proptech/extension";
import { listMediaRows } from "@/lib/proptech/store";
import { getObject } from "@/lib/proptech/storage";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string; mediaId: string }> };

// Photo bytes for the extension to drop into the portal's upload field (same agency only).
export async function GET(req: Request, { params }: P) {
  const c = await extGuard(req);
  if (c instanceof Response) return c;
  const { id, mediaId } = await params;
  const m = (await listMediaRows(c.ws.id, id)).find((x) => String(x.id) === mediaId && x.kind === "photo" && !x.removed);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await getObject(c.ws.id, String(m.path))), { headers: { "Content-Type": String(m.mime_type || "image/jpeg"), "Cache-Control": "no-store" } });
}

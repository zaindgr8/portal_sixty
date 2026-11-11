import { feedMedia, feedOwner } from "@/lib/proptech/adapters/bayut";
import { getObject } from "@/lib/proptech/storage";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ agencyId: string; file: string; mediaId: string }> };

// Photos referenced by the feed. Only photos of listings currently in that agency's feed, behind the same token.
export async function GET(_req: Request, { params }: P) {
  const { agencyId, file: token, mediaId } = await params;
  const conn = await feedOwner(agencyId, token).catch(() => null);
  if (!conn) return new Response("Not found", { status: 404 });
  const m = await feedMedia(agencyId, mediaId).catch(() => null);
  if (!m) return new Response("Not found", { status: 404 });
  const buf = await getObject(agencyId, m.path);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": m.mime, "Cache-Control": "public, max-age=86400" } });
}

import { feedOwner, serveFeed } from "@/lib/proptech/adapters/bayut";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ agencyId: string; file: string }> };

// Public: Bayut / dubizzle fetch this. The random token in the file name is the only key, so a wrong
// agency or token gets the same 404 as a missing feed.
export async function GET(req: Request, { params }: P) {
  const { agencyId, file } = await params;
  const token = file.replace(/\.xml$/, "");
  if (!file.endsWith(".xml")) return new Response("Not found", { status: 404 });
  try {
    const conn = await feedOwner(agencyId, token);
    if (!conn) return new Response("Not found", { status: 404 });
    const xml = await serveFeed(agencyId, token, req);
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" } });
  } catch (err) {
    console.error("[proptech:bayut] feed error", err);
    return new Response("Feed temporarily unavailable", { status: 503 });
  }
}

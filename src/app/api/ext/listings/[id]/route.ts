import { extGuard } from "@/lib/proptech/extension";
import { extJson, extSheet } from "@/lib/proptech/ext-server";
import { getListing, logPortalEvent } from "@/lib/proptech/store";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: P) {
  const c = await extGuard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const portal = new URL(req.url).searchParams.get("portal");
  if (portal !== "propertyfinder" && portal !== "bayut") return extJson({ error: "Pick propertyfinder or bayut." }, 400);
  const l = await getListing(c.ws.id, id);
  if (!l) return extJson({ error: "Listing not found." }, 404);
  await logPortalEvent(c.ws.id, { listingId: id, portal, action: "ext_opened", ok: true, request: { by: c.user.username } });
  return extJson(await extSheet(c.ws.id, l, portal));
}

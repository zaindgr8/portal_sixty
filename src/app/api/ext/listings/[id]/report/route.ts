import { extGuard } from "@/lib/proptech/extension";
import { extJson } from "@/lib/proptech/ext-server";
import { audit, getListing, logPortalEvent, setPortalListing, updateListing } from "@/lib/proptech/store";
import { validateFor } from "@/lib/proptech/publish";
import { EXT_PREFIX } from "@/lib/proptech/manual";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

// What the extension did on the portal: filled the form, the agent submitted it (with the new listing link), or it failed.
// Everything lands in the listing's event log, so the portal shows what happened in Chrome.
export async function POST(req: Request, { params }: P) {
  const c = await extGuard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const l = await getListing(c.ws.id, id);
  if (!l) return extJson({ error: "Listing not found." }, 404);
  const b = (await req.json().catch(() => ({}))) as { portal?: string; event?: string; url?: string; filled?: number; missing?: string[]; error?: string; page?: string };
  const portal = b.portal === "propertyfinder" || b.portal === "bayut" ? b.portal : null;
  if (!portal) return extJson({ error: "Pick propertyfinder or bayut." }, 400);
  const event = ["filled", "posted", "failed"].includes(String(b.event)) ? String(b.event) : null;
  if (!event) return extJson({ error: "Unknown event." }, 400);
  const detail = { by: c.user.username, filled: b.filled, missing: (b.missing ?? []).slice(0, 40), page: String(b.page ?? "").slice(0, 300), url: String(b.url ?? "").slice(0, 500) || undefined };
  if (event === "posted") {
    const v = await validateFor(c.ws.id, l, [portal]);
    if (!v.ok) return extJson({ error: "This listing doesn't pass the checks yet. Open it in Sixty and fix the checklist.", issues: v.issues }, 422);
    await setPortalListing(c.ws.id, id, portal, { status: "live", externalId: `${EXT_PREFIX}${detail.url || "posted"}`, lastError: null });
    if (l.status !== "published") await updateListing(c.ws.id, id, { status: "published", approved_at: new Date().toISOString(), approved_by: c.user.username });
    await audit(c.ws.id, id, c.user.username, "publish", { portals: [portal], via: "extension", url: detail.url ?? null });
  }
  if (event === "failed") {
    const msg = String(b.error ?? "The extension couldn't finish.").slice(0, 500);
    await setPortalListing(c.ws.id, id, portal, { status: "queued", lastError: { code: "EXTENSION", message: msg, plain: `The Chrome extension stopped: ${msg}` } });
  }
  await logPortalEvent(c.ws.id, { listingId: id, portal, action: `ext_${event}`, ok: event !== "failed", request: detail, error: event === "failed" ? String(b.error ?? "") : null });
  return extJson({ ok: true });
}

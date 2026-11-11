import { guard, handle, json } from "@/lib/proptech/access";
import { createListing, listConnections, listListings } from "@/lib/proptech/store";
import { signUrls } from "@/lib/proptech/storage";
import type { ListingSummary } from "@/lib/proptech/types";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const u = new URL(req.url).searchParams;
  const { rows, portals, covers } = await listListings(c.ws.id, { status: u.get("status") || undefined, agent: u.get("agent") || undefined, portal: u.get("portal") || undefined });
  const urls = await signUrls(c.ws.id, covers.map((x) => x.path));
  const listings: ListingSummary[] = rows.map((r) => ({
    id: r.id as string, status: r.status as ListingSummary["status"], title: (r.title_en as string) || "Untitled listing", community: (r.community as string) ?? null,
    propertyType: (r.property_type as string) ?? null, price: r.price == null ? null : Number(r.price), priceType: (r.price_type as string) ?? null,
    offeringType: (r.offering_type as string) ?? null, agentId: (r.agent_id as string) ?? null, createdBy: r.created_by as string,
    coverUrl: urls.get(covers.find((x) => x.listing_id === r.id)?.path ?? ""), portals: portals.filter((p) => p.listing_id === r.id).map((p) => ({ portal: p.portal, status: p.status })),
    createdAt: r.created_at as string, updatedAt: r.updated_at as string, aiCostUsd: Number(r.ai_cost_usd ?? 0),
  }));
  return json({ listings });
});

// A new draft. Agency ORN and the agent's BRN come from Portal Settings when they're saved there.
export const POST = handle(async (req: Request) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const conns = await listConnections(c.ws.id);
  const orn = conns.map((x) => x.defaults.orn).find(Boolean);
  const brn = conns.map((x) => x.defaults.agents?.[c.user.username]?.brn).find(Boolean);
  const l = await createListing(c.ws.id, c.user.username, {
    ...(orn ? { agency_orn: orn } : {}), ...(brn ? { agent_brn: brn } : {}),
    field_source: { ...(orn ? { agency_orn: { source: "agent" } } : {}), ...(brn ? { agent_brn: { source: "agent" } } : {}) },
  });
  return json({ id: l.id }, 201);
});

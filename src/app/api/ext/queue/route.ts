import { q, sb } from "@/lib/supabase";
import { extGuard } from "@/lib/proptech/extension";
import { extJson } from "@/lib/proptech/ext-server";

export const dynamic = "force-dynamic";

// Listings waiting for this agency's extension, and the ones it posted recently.
export async function GET(req: Request) {
  const c = await extGuard(req);
  if (c instanceof Response) return c;
  const ws = q(c.ws.id);
  const rows = await sb<{ listing_id: string; portal: string; status: string; external_id: string | null; last_error: { plain?: string } | null; updated_at: string }[]>(
    `portal_listings?workspace_id=eq.${ws}&portal=in.(propertyfinder,bayut)&external_id=like.ext:*&select=listing_id,portal,status,external_id,last_error,updated_at&order=updated_at.desc&limit=100`,
  );
  const ids = [...new Set(rows.map((r) => r.listing_id))];
  const listings = ids.length
    ? await sb<{ id: string; title_en: string | null; community: string | null; price: number | null; agent_id: string | null }[]>(`listings?workspace_id=eq.${ws}&id=in.(${ids.join(",")})&select=id,title_en,community,price,agent_id`)
    : [];
  const byId = new Map(listings.map((l) => [l.id, l]));
  const item = (r: (typeof rows)[number]) => {
    const l = byId.get(r.listing_id);
    return {
      listingId: r.listing_id, portal: r.portal, status: r.status, title: l?.title_en || "Untitled listing", community: l?.community, price: l?.price,
      agent: l?.agent_id, mine: l?.agent_id === c.user.username, url: r.external_id && r.external_id !== "ext:pending" ? r.external_id.slice(4) : null,
      error: r.last_error?.plain ?? null, updatedAt: r.updated_at,
    };
  };
  return extJson({
    waiting: rows.filter((r) => r.status === "queued" || r.status === "rejected").map(item),
    done: rows.filter((r) => r.status === "live" || r.status === "submitted").slice(0, 20).map(item),
  });
}

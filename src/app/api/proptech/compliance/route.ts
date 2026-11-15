import { guard, handle, json } from "@/lib/proptech/access";
import { byUrgency, complianceFor } from "@/lib/proptech/compliance";
import { q, sb } from "@/lib/supabase";
import type { Portal, PortalStatus } from "@/lib/proptech/types";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

// Every listing's Form A → permit → live status, most urgent first.
export const GET = handle(async (req: Request) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const ws = `workspace_id=eq.${q(c.ws.id)}`;
  const [rows, portals, formAs] = await Promise.all([
    sb<Row[]>(`listings?${ws}&status=neq.archived&select=id,status,title_en,community,building,agent_id,updated_at,permit_number,permit_expiry,permit_applied_at,form_a_number,form_a_expiry&order=updated_at.desc&limit=500`),
    sb<{ listing_id: string; portal: Portal; status: PortalStatus }[]>(`portal_listings?${ws}&select=listing_id,portal,status`),
    sb<{ listing_id: string }[]>(`listing_media?${ws}&kind=eq.form_a&removed=eq.false&select=listing_id`),
  ]);
  const hasFormA = new Set(formAs.map((m) => m.listing_id));
  const items = rows.map((r) => {
    const compliance = complianceFor(
      { permit_number: r.permit_number as string | null, permit_expiry: r.permit_expiry as string | null, form_a_number: r.form_a_number as string | null, form_a_expiry: r.form_a_expiry as string | null, permitAppliedAt: r.permit_applied_at as string | null },
      { hasFormA: hasFormA.has(r.id as string), portals: portals.filter((p) => p.listing_id === r.id) },
    );
    return { id: r.id as string, title: (r.title_en as string) || "Untitled listing", place: [r.building, r.community].filter(Boolean).join(", "), status: r.status as string, agentId: (r.agent_id as string) ?? null, updatedAt: r.updated_at as string, compliance };
  });
  items.sort((a, b) => byUrgency(a.compliance, b.compliance));
  const count = (f: (x: (typeof items)[number]) => boolean) => items.filter(f).length;
  return json({
    items,
    summary: {
      urgent: count((x) => x.compliance.level === "bad"),
      expiringSoon: count((x) => x.compliance.alerts.some((a) => a.kind === "permit_expiring" || a.kind === "form_a_expiring")),
      waiting: count((x) => x.compliance.stage === "waiting"),
      toApply: count((x) => x.compliance.stage === "apply"),
      live: count((x) => x.compliance.stage === "live"),
    },
  });
});

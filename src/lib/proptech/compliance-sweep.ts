import "server-only";
import { q, sb } from "../supabase";
import { isAgentPosted } from "./manual";
import { requestUnpublish } from "./publish";
import { audit, logPortalEvent, setPortalListing } from "./store";
import { PORTAL_LABEL, type Portal } from "./types";

const ACTOR = "Sixty (permit expired)";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Daily: a listing still on a portal after its Trakheesi permit expired gets removed by the portal and fined
 * by DLD. Listings Sixty posted itself (API, Bayut feed) are taken down automatically; ones the agent posted
 * (Chrome extension, by hand) get a red "take it down or renew" notice, since only the agent can reach them.
 */
export async function complianceSweep() {
  const expired = await sb<{ id: string; workspace_id: string; permit_expiry: string }[]>(
    `listings?permit_expiry=lt.${today()}&status=in.(approved,published)&select=id,workspace_id,permit_expiry&limit=1000`,
  );
  let takenDown = 0, flagged = 0;
  for (const l of expired) {
    const rows = await sb<{ portal: Portal; status: string; external_id: string | null; last_error: { code?: string } | null }[]>(
      `portal_listings?workspace_id=eq.${q(l.workspace_id)}&listing_id=eq.${q(l.id)}&status=in.(live,submitted,queued)&select=portal,status,external_id,last_error`,
    );
    const auto = rows.filter((r) => !isAgentPosted(r.external_id) && r.portal !== "mock");
    const byHand = rows.filter((r) => isAgentPosted(r.external_id) && r.last_error?.code !== "permit_expired");
    if (auto.length) {
      await requestUnpublish(l.workspace_id, ACTOR, l.id, auto.map((r) => r.portal));
      takenDown += auto.length;
    }
    for (const r of byHand) {
      const plain = `The Trakheesi permit expired on ${l.permit_expiry}. Take this listing down on ${PORTAL_LABEL[r.portal]} now (portals remove it and DLD fines apply), or renew the permit and update it.`;
      await setPortalListing(l.workspace_id, l.id, r.portal, { lastError: { code: "permit_expired", message: "Permit expired", plain } });
      await logPortalEvent(l.workspace_id, { listingId: l.id, portal: r.portal, action: "permit_expired", ok: false, error: plain });
      flagged++;
    }
    if (auto.length || byHand.length) await audit(l.workspace_id, l.id, ACTOR, "permit_expired", { takenDown: auto.map((r) => r.portal), flagged: byHand.map((r) => r.portal) });
  }
  return { checked: expired.length, takenDown, flagged };
}

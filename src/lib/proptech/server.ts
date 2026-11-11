import "server-only";
import { signUrls } from "./storage";
import {
  getInputs, getListingRow, listAgents, listAudit, listConnections, listMediaRows, listPortalEvents, listPortalListings, listUsage, maskOwner, readOwner, toListing, toMedia,
} from "./store";
import { portalMethods, validateFor } from "./publish";
import { FIELD_LABEL } from "./validate";
import { PROPERTY_TYPE_LABEL, type Listing, type ListingBundle, type OwnerPii } from "./types";
import type { Ctx } from "./access";

/** Everything the Listing Detail screen shows. Owner data is masked unless the viewer is an agency admin. */
export async function loadBundle(c: Ctx, id: string): Promise<ListingBundle | null> {
  const ws = c.ws.id;
  const row = await getListingRow(ws, id);
  if (!row) return null;
  const listing = toListing(row);
  const [mediaRows, inputs, portals, methods, events, auditLog, usage] = await Promise.all([
    listMediaRows(ws, id), getInputs(ws, id), listPortalListings(ws, id), portalMethods(ws),
    c.admin ? listPortalEvents(ws, id) : Promise.resolve([]), listAudit(ws, id), listUsage(ws, id),
  ]);
  const connected = Object.keys(methods) as (keyof typeof methods)[];
  const urls = await signUrls(ws, mediaRows.map((r) => String(r.path)));
  const media = mediaRows.map((r) => ({ ...toMedia(r), url: urls.get(String(r.path)) }));
  const validation = await validateFor(ws, listing, portals.map((p) => p.portal).filter((p) => connected.includes(p)));
  const owner = readOwner(row);
  const [conns, team] = await Promise.all([listConnections(ws), listAgents(ws)]);
  const saved = conns.map((x) => x.defaults.agents?.[listing.agentId ?? ""]).find(Boolean) ?? {};
  const member = team.find((a) => a.username === listing.agentId);
  return {
    agent: { name: saved.name || member?.display_name || listing.agentId || undefined, phone: saved.phone, email: saved.email || member?.email || undefined },
    listing, media,
    inputs: { agentNotes: String(inputs.agent_notes ?? ""), voiceTranscript: String(inputs.voice_transcript ?? "") },
    owner: c.admin ? owner : maskOwner(owner), ownerMasked: !c.admin,
    portals, connectedPortals: connected, methods, validation, events, audit: auditLog, usage, canAdmin: c.admin,
  };
}

/** A clean text block with everything needed to apply for the Trakheesi permit (done by hand on the DLD side). */
export function permitBlock(l: Listing, owner: OwnerPii | null, agencyName: string) {
  const row = (k: string, v: unknown) => `${k.padEnd(24)}${v === null || v === undefined || v === "" ? "—" : String(v)}`;
  const type = l.property_type ? PROPERTY_TYPE_LABEL[l.property_type] ?? l.property_type : null;
  return [
    "TRAKHEESI PERMIT APPLICATION DATA",
    `Generated ${new Date().toISOString().slice(0, 10)} · ${agencyName}`,
    "",
    "AGENCY / AGENT",
    row("Agency ORN", l.agency_orn), row("Agent BRN", l.agent_brn), row("Agent", l.agentId),
    "",
    "CONTRACT (FORM A)",
    row("Form A number", l.form_a_number), row("Form A expiry", l.form_a_expiry),
    row("Owner name", owner?.name), row("Owner Emirates ID / PP", owner?.idNumber),
    "",
    "PROPERTY",
    row("Purpose", l.offering_type === "rent" ? "Rent" : l.offering_type === "sale" ? "Sale" : null),
    row("Property type", type), row("Status", l.completion_status === "off_plan" ? "Off-plan" : l.completion_status === "ready" ? "Ready" : null),
    row("Emirate", l.emirate), row("Community", l.community), row("Sub-community", l.sub_community), row("Building / project", l.building),
    row("Unit number", l.unit_number), row("Floor", l.floor), row("Bedrooms", l.bedrooms === 0 ? "Studio" : l.bedrooms), row("Bathrooms", l.bathrooms),
    row("Size (sqft)", l.size_sqft), row("Plot (sqft)", l.plot_sqft), row("Developer", l.developer),
    "",
    "PRICE",
    row("Price (AED)", l.price), row(FIELD_LABEL.price_type ?? "Period", l.price_type), row("Cheques", l.cheques),
  ].join("\n");
}

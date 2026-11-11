import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { listConnections, listMediaRows, toMedia, listAgents } from "./store";
import { manualSheet } from "./manual";
import type { Listing } from "./types";

export const extJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Fill rules for the extension (label synonyms, selectors, URLs per portal). Served live, so changing
 *  mappings/extension.json updates every installed extension without a new release. */
export function extensionConfig() {
  return JSON.parse(readFileSync(path.join(process.cwd(), "mappings", "extension.json"), "utf8")) as Record<string, unknown>;
}

/** Everything the extension needs to fill one portal's form for one listing. Never owner data or the unit number. */
export async function extSheet(ws: string, l: Listing, portal: "propertyfinder" | "bayut") {
  const [conns, team, media] = await Promise.all([listConnections(ws), listAgents(ws), listMediaRows(ws, l.id)]);
  const saved = conns.map((x) => x.defaults.agents?.[l.agentId ?? ""]).find(Boolean) ?? {};
  const member = team.find((a) => a.username === l.agentId);
  const agent = { name: saved.name || member?.display_name || l.agentId || undefined, phone: saved.phone, email: saved.email || member?.email || undefined };
  const photos = media.filter((m) => m.kind === "photo" && !m.removed)
    .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || Number(a.sort_order) - Number(b.sort_order))
    .map((m, i) => ({ id: String(m.id), name: `${String(i + 1).padStart(2, "0")}-${m.is_cover ? "cover" : String(m.room_type ?? "photo")}.${String(m.mime_type).includes("png") ? "png" : "jpg"}`, mime: String(m.mime_type), cover: Boolean(m.is_cover), media: toMedia(m) }));
  return {
    listing: { id: l.id, title: l.title_en, status: l.status, reference: `SX-${l.id.slice(0, 8).toUpperCase()}` },
    fields: manualSheet(l, portal, agent),
    // Raw values for matching dropdowns and split location fields.
    values: {
      purpose: l.offering_type, category: l.category, property_type: l.property_type, completion_status: l.completion_status,
      emirate: l.emirate, community: l.community, sub_community: l.sub_community, building: l.building,
      bedrooms: l.bedrooms, bathrooms: l.bathrooms, size_sqft: l.size_sqft, plot_sqft: l.plot_sqft, price: l.price, price_type: l.price_type,
      cheques: l.cheques, furnishing: l.furnishing, parking: l.parking, floor: l.floor, view: l.view, developer: l.developer,
      handover_date: l.handover_date, payment_plan: l.payment_plan, service_charge: l.service_charge, amenities: l.amenities,
      permit_number: l.permit_number, permit_expiry: l.permit_expiry, agent_brn: l.agent_brn, agency_orn: l.agency_orn,
      title_en: l.title_en, description_en: l.description_en, title_ar: l.title_ar, description_ar: l.description_ar,
      agent_name: agent.name, agent_phone: agent.phone, agent_email: agent.email,
    },
    photos: photos.map(({ id, name, mime, cover }) => ({ id, name, mime, cover })),
  };
}

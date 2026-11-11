// Listing copy: what facts Gemini may use, and how its answer becomes a title + description.
import { PROPERTY_TYPE_LABEL, type Listing } from "./types";
import { TITLE_MAX, scrubCopy } from "./validate";
import type { CopyResult } from "./schema";

/** Only verified, publishable facts. Never the owner, the unit number or Form A details. */
export function copyFacts(l: Listing) {
  const f: Record<string, unknown> = {
    offering: l.offering_type, type: l.property_type ? PROPERTY_TYPE_LABEL[l.property_type] ?? l.property_type : null,
    status: l.completion_status === "off_plan" ? "off-plan" : l.completion_status, emirate: l.emirate, community: l.community,
    sub_community: l.sub_community, building: l.building, bedrooms: l.bedrooms === 0 ? "studio" : l.bedrooms, bathrooms: l.bathrooms,
    size_sqft: l.size_sqft, plot_sqft: l.plot_sqft, parking: l.parking, furnishing: l.furnishing, view: l.view, floor: l.floor,
    amenities: l.amenities.length ? l.amenities : null, price_aed: l.price, price_period: l.price_type, cheques: l.cheques,
    service_charge_aed_per_sqft: l.service_charge, developer: l.developer, handover: l.handover_date, payment_plan: l.payment_plan,
  };
  if (l.price && l.size_sqft && l.offering_type === "sale") f.price_per_sqft_aed = Math.round(l.price / l.size_sqft);
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

/** Join hook, bullets and body; strip contact details/emoji; keep the title within the limit. */
export function assembleCopy(c: CopyResult) {
  const bullets = c.highlights.map((h) => `• ${h.replace(/^[•\-*•\s]+/, "").trim()}`).join("\n");
  const description = scrubCopy(`${c.hook.trim()}\n\n${bullets}\n\n${c.body.trim()}`);
  return { title: fitTitle(scrubCopy(c.title)), description };
}

export function fitTitle(t: string, max = TITLE_MAX) {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  // Drop the middle part first ("[Type] | [Point] | [Community]"), then hard-cut at a word.
  const parts = s.split("|").map((p) => p.trim());
  if (parts.length === 3) {
    const two = `${parts[0]} | ${parts[2]}`;
    if (two.length <= max) {
      const room = max - two.length - 3;
      if (room > 6) return `${parts[0]} | ${parts[1].slice(0, room).replace(/\s+\S*$/, "")} | ${parts[2]}`;
      return two;
    }
  }
  return s.slice(0, max).replace(/\s+\S*$/, "").replace(/[|,\s]+$/, "");
}

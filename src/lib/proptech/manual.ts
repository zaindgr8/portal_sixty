// "Copy & paste" posting: every field the agent types into a portal's own listing form, in that form's
// order, with the portal's wording. Pure and shared by the server and the browser.
import { PROPERTY_TYPE_LABEL, type Listing, type Portal } from "./types";

export const MANUAL_PREFIX = "manual:";
export const isManual = (externalId: string | null | undefined) => Boolean(externalId?.startsWith(MANUAL_PREFIX));
/** Posted (or waiting to be posted) through the Sixty Chrome extension: "ext:pending" until it reports the portal link. */
export const EXT_PREFIX = "ext:";
export const EXT_PENDING = "ext:pending";
export const isExtension = (externalId: string | null | undefined) => Boolean(externalId?.startsWith(EXT_PREFIX));
/** Posted by a person (by hand or with the extension) rather than by our API or feed. */
export const isAgentPosted = (externalId: string | null | undefined) => isManual(externalId) || isExtension(externalId);

export interface SheetField { key: string; label: string; value: string; long?: boolean; rtl?: boolean }

const FURNISH: Record<string, string> = { furnished: "Furnished", semi_furnished: "Semi-furnished", unfurnished: "Unfurnished" };
const v = (x: unknown) => (x === null || x === undefined || x === "" ? "" : Array.isArray(x) ? x.join(", ") : String(x));

export function manualSheet(l: Listing, portal: Exclude<Portal, "mock">, agent: { name?: string; phone?: string; email?: string } = {}): SheetField[] {
  const bayut = portal === "bayut";
  const rent = l.offering_type === "rent";
  const rows: SheetField[] = [
    { key: "purpose", label: bayut ? "Purpose" : "Offering type", value: rent ? (bayut ? "Rent" : "Rent") : l.offering_type ? (bayut ? "Buy" : "Sale") : "" },
    { key: "category", label: "Category", value: l.category === "commercial" ? "Commercial" : l.category ? "Residential" : "" },
    { key: "type", label: "Property type", value: l.property_type ? PROPERTY_TYPE_LABEL[l.property_type] ?? l.property_type : "" },
    { key: "status", label: "Completion status", value: l.completion_status === "off_plan" ? "Off-plan" : l.completion_status === "ready" ? "Ready" : "" },
    { key: "location", label: bayut ? "Location (city › area › sub-area › building)" : "Location", value: [l.emirate, l.community, l.sub_community, l.building].filter(Boolean).join(" › ") },
    { key: "bedrooms", label: "Bedrooms", value: l.bedrooms === 0 ? "Studio" : v(l.bedrooms) },
    { key: "bathrooms", label: "Bathrooms", value: v(l.bathrooms) },
    { key: "size", label: "Size (sqft)", value: v(l.size_sqft) },
    { key: "plot", label: "Plot size (sqft)", value: v(l.plot_sqft) },
    { key: "price", label: rent ? "Rent (AED)" : "Price (AED)", value: v(l.price) },
    { key: "period", label: "Rent frequency", value: rent ? (l.price_type === "monthly" ? "Monthly" : "Yearly") : "" },
    { key: "cheques", label: "Number of cheques", value: rent ? v(l.cheques) : "" },
    { key: "furnishing", label: "Furnishing", value: l.furnishing ? FURNISH[l.furnishing] : "" },
    { key: "parking", label: "Parking spaces", value: v(l.parking) },
    { key: "floor", label: "Floor", value: v(l.floor) },
    { key: "view", label: "View", value: v(l.view) },
    { key: "developer", label: "Developer", value: v(l.developer) },
    { key: "handover", label: "Handover date", value: l.completion_status === "off_plan" ? v(l.handover_date) : "" },
    { key: "payment_plan", label: "Payment plan", value: l.completion_status === "off_plan" ? v(l.payment_plan) : "", long: true },
    { key: "service_charge", label: "Service charge (AED/sqft)", value: v(l.service_charge) },
    { key: "amenities", label: bayut ? "Features / amenities" : "Amenities", value: v(l.amenities) },
    { key: "permit", label: bayut ? "Permit number (Trakheesi)" : "DLD permit number", value: v(l.permit_number) },
    { key: "brn", label: "Agent BRN", value: v(l.agent_brn) },
    { key: "orn", label: "Agency ORN", value: v(l.agency_orn) },
    { key: "agent", label: "Listing agent", value: [agent.name, agent.phone, agent.email].filter(Boolean).join(" · ") },
    { key: "title_en", label: "Title (English)", value: v(l.title_en) },
    { key: "description_en", label: "Description (English)", value: v(l.description_en), long: true },
    { key: "title_ar", label: "Title (Arabic)", value: v(l.title_ar), rtl: true },
    { key: "description_ar", label: "Description (Arabic)", value: v(l.description_ar), long: true, rtl: true },
    { key: "reference", label: "Your reference", value: `SX-${l.id.slice(0, 8).toUpperCase()}` },
  ];
  return rows.filter((r) => r.value);
}

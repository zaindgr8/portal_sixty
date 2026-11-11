// Pre-publish checks. Pure: give it the listing, its photos and the portal rules, get back what blocks publishing.
import type { Listing, ListingField, ListingMedia, Portal, ValidationIssue, ValidationResult } from "./types";

export const TITLE_MAX = 50;
export const DESC_MIN = 750;
export const DESC_MAX = 1500;
export const MIN_PHOTOS = 5;
export const MAX_PHOTOS = 50;
export const MIN_SHORT_SIDE = 800;

// Contact details and emoji are not allowed in listing copy (both portals reject them).
const PHONE = /(?:\+?971|00971|\b0)\s*-?\(?\d{1,2}\)?[\s-]?\d{3}[\s-]?\d{4}\b|\+\d[\d\s-]{8,}\d|\b\d{3}[\s-]\d{3}[\s-]\d{4}\b|\b05\d{8}\b/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|ae|net|org|io|co)\b(?:\/|\b)/i;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function copyProblems(text: string | null | undefined): string[] {
  if (!text) return [];
  const p: string[] = [];
  if (PHONE.test(text)) p.push("a phone number");
  if (EMAIL.test(text)) p.push("an email address");
  if (URL_RE.test(text)) p.push("a web address");
  if (EMOJI.test(text)) p.push("emoji");
  return p;
}

/** Remove contact details and emoji from AI copy before it is saved (belt and braces on top of the prompt). */
export function scrubCopy(text: string) {
  return text
    .replace(new RegExp(PHONE.source, "g"), "")
    .replace(new RegExp(EMAIL.source, "gi"), "")
    .replace(new RegExp(URL_RE.source, "gi"), "")
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface PortalRules {
  titleMax?: number; descMin?: number; descMax?: number; minPhotos?: number; maxPhotos?: number;
  required?: ListingField[]; requireArabic?: boolean;
}

export interface ValidateInput {
  listing: Listing;
  media: ListingMedia[];
  portals?: Portal[];
  rules?: Partial<Record<Portal, PortalRules>>;
  today?: Date;
}

const RESIDENTIAL_TYPES = new Set(["apartment", "villa", "townhouse", "penthouse", "duplex", "hotel_apartment"]);
const isResidential = (l: Listing) => l.category === "residential" || (l.category == null && RESIDENTIAL_TYPES.has(l.property_type ?? ""));

export const REQUIRED_BASE: ListingField[] = ["offering_type", "property_type", "price", "community", "size_sqft", "title_en", "description_en", "permit_number", "permit_expiry", "agent_brn", "agency_orn"];

export const FIELD_LABEL: Partial<Record<ListingField, string>> = {
  offering_type: "Sale or rent", category: "Category", property_type: "Property type", completion_status: "Ready or off-plan", emirate: "Emirate",
  community: "Community", sub_community: "Sub-community", building: "Building / project", unit_number: "Unit number", bedrooms: "Bedrooms",
  bathrooms: "Bathrooms", size_sqft: "Size (sqft)", plot_sqft: "Plot (sqft)", parking: "Parking spaces", furnishing: "Furnishing", view: "View",
  floor: "Floor", amenities: "Amenities", price: "Price (AED)", price_type: "Price period", cheques: "Cheques", service_charge: "Service charge (AED/sqft)",
  developer: "Developer", handover_date: "Handover date", payment_plan: "Payment plan", form_a_number: "Form A number", form_a_expiry: "Form A expiry",
  permit_number: "Trakheesi permit number", permit_expiry: "Permit expiry", agency_orn: "Agency ORN", agent_brn: "Agent BRN",
  title_en: "English title", title_ar: "Arabic title", description_en: "English description", description_ar: "Arabic description",
};

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function requiredFields(l: Listing): ListingField[] {
  const req = [...REQUIRED_BASE];
  if (isResidential(l)) req.push("bedrooms", "bathrooms");
  if (l.offering_type === "rent") req.push("price_type");
  if (l.completion_status === "off_plan") req.push("handover_date", "developer");
  return req;
}

export function validateListing({ listing: l, media, portals = [], rules = {}, today = new Date() }: ValidateInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (message: string, field?: ValidationIssue["field"], portal?: Portal) => issues.push({ level: "error", message, field, portal });
  const confirm = (message: string, field?: ValidationIssue["field"]) => issues.push({ level: "confirm", message, field });
  const warn = (message: string, field?: ValidationIssue["field"]) => issues.push({ level: "warning", message, field });
  const t0 = dayStart(today).getTime();

  for (const f of requiredFields(l)) if (empty(l[f])) err(`${FIELD_LABEL[f] ?? f} is required.`, f);

  // Dates
  if (l.permit_expiry && new Date(l.permit_expiry).getTime() <= t0) err("The Trakheesi permit has expired. Enter a valid permit.", "permit_expiry");
  if (l.permit_number && !/^[A-Za-z0-9-]{4,30}$/.test(l.permit_number.trim())) err("The permit number looks wrong (letters and digits only).", "permit_number");
  if (l.form_a_expiry && new Date(l.form_a_expiry).getTime() < t0) err("Form A has expired. Renew it with the owner before listing.", "form_a_expiry");
  if (!l.form_a_expiry) warn("Form A expiry isn't filled in. Check it's still valid.", "form_a_expiry");
  if (l.agency_orn && !/^\d{3,7}$/.test(l.agency_orn.trim())) err("Agency ORN should be digits only.", "agency_orn");
  if (l.agent_brn && !/^\d{3,7}$/.test(l.agent_brn.trim())) err("Agent BRN should be digits only.", "agent_brn");

  // Price sanity
  if (l.price != null) {
    if (l.price <= 0) err("Price must be more than zero.", "price");
    else if (l.offering_type === "sale" && l.price < 100_000) confirm(`Sale price ${l.price.toLocaleString("en-US")} AED is unusually low. Confirm it's right.`, "price");
    else if (l.offering_type === "rent" && l.price_type === "yearly" && l.price > 5_000_000) confirm(`Yearly rent ${l.price.toLocaleString("en-US")} AED is unusually high. Confirm it's right.`, "price");
    else if (l.offering_type === "rent" && l.price_type === "monthly" && l.price > 500_000) confirm("Monthly rent looks unusually high. Confirm it's right.", "price");
  }
  if (l.size_sqft != null && (l.size_sqft < 100 || l.size_sqft > 200_000)) confirm("Size looks unusual. Check it's in square feet.", "size_sqft");

  // Copy
  checkCopy(l.title_en, "title_en", TITLE_MAX, 0, 0, err);
  checkCopy(l.description_en, "description_en", 0, DESC_MIN, DESC_MAX, err);
  if (l.title_ar || l.description_ar) {
    checkCopy(l.title_ar, "title_ar", TITLE_MAX, 0, 0, err);
    checkCopy(l.description_ar, "description_ar", 0, DESC_MIN, DESC_MAX, err);
  }

  // Photos
  const photos = media.filter((m) => m.kind === "photo" && !m.removed);
  if (photos.length < MIN_PHOTOS) err(`Add at least ${MIN_PHOTOS} photos (${photos.length} now).`, "photos");
  if (photos.length > MAX_PHOTOS) err(`Up to ${MAX_PHOTOS} photos (${photos.length} now).`, "photos");
  const small = photos.filter((p) => p.width && p.height && Math.min(p.width, p.height) < MIN_SHORT_SIDE);
  if (small.length) err(`${small.length} photo${small.length > 1 ? "s are" : " is"} smaller than ${MIN_SHORT_SIDE}px on the short side. Replace or remove ${small.length > 1 ? "them" : "it"}.`, "photos");
  const cover = photos.find((p) => p.isCover) ?? photos[0];
  if (photos.length && !photos.some((p) => p.isCover)) warn("No cover photo picked; the first photo will be used.", "cover");
  if (cover && (cover.flags.watermark || cover.flags.phone_visible)) err("The cover photo shows a watermark or contact details. Pick another cover.", "cover");
  const flagged = photos.filter((p) => p.flags.watermark || p.flags.phone_visible);
  if (flagged.length) warn(`${flagged.length} photo${flagged.length > 1 ? "s show" : " shows"} a watermark or contact details. Portals may reject ${flagged.length > 1 ? "them" : "it"}.`, "photos");

  // Portal-specific rules from mappings/*.json
  for (const p of portals) {
    const r = rules[p];
    if (!r) continue;
    for (const f of r.required ?? []) if (empty(l[f]) && !issues.some((i) => i.field === f && i.level === "error")) err(`${FIELD_LABEL[f] ?? f} is required by this portal.`, f, p);
    if (r.requireArabic && (empty(l.title_ar) || empty(l.description_ar))) err("This portal needs the Arabic title and description.", empty(l.title_ar) ? "title_ar" : "description_ar", p);
    if (r.titleMax && (l.title_en?.length ?? 0) > r.titleMax) err(`Title must be ${r.titleMax} characters or fewer for this portal.`, "title_en", p);
    if (r.descMax && (l.description_en?.length ?? 0) > r.descMax) err(`Description must be ${r.descMax} characters or fewer for this portal.`, "description_en", p);
    if (r.minPhotos && photos.length < r.minPhotos) err(`This portal needs at least ${r.minPhotos} photos.`, "photos", p);
  }

  return { ok: !issues.some((i) => i.level === "error"), issues };
}

function checkCopy(text: string | null, field: ListingField, maxTitle: number, min: number, max: number, err: (m: string, f?: ListingField) => void) {
  if (!text) return;
  const label = FIELD_LABEL[field] ?? field;
  if (maxTitle && text.length > maxTitle) err(`${label} is ${text.length} characters; keep it to ${maxTitle}.`, field);
  if (min && text.length < min) err(`${label} is ${text.length} characters; it needs at least ${min}.`, field);
  if (max && text.length > max) err(`${label} is ${text.length} characters; keep it to ${max}.`, field);
  const p = copyProblems(text);
  if (p.length) err(`${label} contains ${p.join(", ")}. Portals don't allow that.`, field);
}

/** Is the permit block complete enough to allow publishing at all? */
export function permitReady(l: Listing, today = new Date()) {
  return Boolean(l.permit_number?.trim() && l.permit_expiry && new Date(l.permit_expiry).getTime() > dayStart(today).getTime());
}

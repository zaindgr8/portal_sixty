// Merge what the documents, the agent's notes, the voice note and the photos say into one set of field values.
// Pure functions (no I/O) so they're easy to test.
import { coerceValue, type ExtractedField } from "./schema";
import { LEGAL_FIELDS, type FieldSource, type ListingField, type SourceRef } from "./types";

const DOC: FieldSource[] = ["form_a", "title_deed"];
const LEGAL_ORDER: FieldSource[] = ["form_a", "title_deed", "notes", "voice", "photo", "inferred"];
const MARKETING_ORDER: FieldSource[] = ["notes", "voice", "form_a", "title_deed", "photo", "inferred"];
const legal = new Set<ListingField>(LEGAL_FIELDS);

export interface Merged {
  values: Partial<Record<ListingField, string | number>>;
  confidence: Partial<Record<ListingField, number>>;
  source: Partial<Record<ListingField, SourceRef>>;
  amenities: string[];
  /** Where two sources disagreed on a legal field (shown to the agent, lowers confidence). */
  conflicts: { field: ListingField; kept: string; other: string; otherSource: FieldSource }[];
}

/**
 * Documents win for legal fields (owner, unit, size, price, Form A number/dates); the agent's notes and voice win
 * for marketing fields (view, condition, highlights). Within the same rank the more confident value wins.
 */
export function mergeFields(candidates: ExtractedField[], amenityLists: string[][] = [], mediaFor: Partial<Record<FieldSource, string>> = {}): Merged {
  const out: Merged = { values: {}, confidence: {}, source: {}, amenities: [], conflicts: [] };
  const byField = new Map<ListingField, (ExtractedField & { coerced: string | number })[]>();
  for (const c of candidates) {
    const coerced = coerceValue(c.field, c.value);
    if (coerced === undefined || coerced === null) continue;
    // An "inferred" legal value is never good enough to keep on its own above 0.6.
    const confidence = c.source === "inferred" ? Math.min(c.confidence, 0.6) : c.confidence;
    const list = byField.get(c.field) ?? [];
    list.push({ ...c, confidence, coerced });
    byField.set(c.field, list);
  }
  for (const [field, list] of byField) {
    const order = legal.has(field) ? LEGAL_ORDER : MARKETING_ORDER;
    const rank = (s: FieldSource) => { const i = order.indexOf(s); return i < 0 ? 99 : i; };
    list.sort((a, b) => rank(a.source) - rank(b.source) || b.confidence - a.confidence);
    const best = list[0];
    let confidence = best.confidence;
    if (legal.has(field)) {
      const other = list.find((x) => String(x.coerced).toLowerCase() !== String(best.coerced).toLowerCase() && (DOC.includes(x.source) || x.confidence >= 0.7));
      if (other) {
        out.conflicts.push({ field, kept: String(best.coerced), other: String(other.coerced), otherSource: other.source });
        confidence = Math.min(confidence, 0.6); // make the reviewer look at it
      }
    } else if (list.some((x) => String(x.coerced).toLowerCase() === String(best.coerced).toLowerCase() && x !== best)) {
      confidence = Math.min(1, confidence + 0.05); // two sources agree
    }
    out.values[field] = best.coerced;
    out.confidence[field] = round(confidence);
    out.source[field] = { source: best.source, ...(best.page ? { page: best.page } : {}), ...(best.snippet ? { snippet: best.snippet } : {}), ...(mediaFor[best.source] ? { mediaId: mediaFor[best.source] } : {}) };
  }
  // Derive a few fields that are safe to infer.
  if (out.values.category === undefined && typeof out.values.property_type === "string") {
    const commercial = ["office", "retail", "warehouse"].includes(out.values.property_type);
    out.values.category = commercial ? "commercial" : "residential";
    out.confidence.category = 0.75;
    out.source.category = { source: "inferred" };
  }
  if (out.values.price_type === undefined && out.values.offering_type === "sale") {
    out.values.price_type = "sale"; out.confidence.price_type = 0.9; out.source.price_type = { source: "inferred" };
  }
  if (out.values.emirate === undefined && out.values.community !== undefined) {
    out.values.emirate = "Dubai"; out.confidence.emirate = 0.6; out.source.emirate = { source: "inferred" };
  }
  out.amenities = dedupe(amenityLists.flat());
  return out;
}

export function dedupe(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const a = raw.trim().replace(/\s+/g, " ");
    const k = a.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "");
    if (!a || seen.has(k)) continue;
    seen.add(k);
    out.push(a.charAt(0).toUpperCase() + a.slice(1));
  }
  return out.slice(0, 40);
}

const round = (n: number) => Math.round(n * 100) / 100;

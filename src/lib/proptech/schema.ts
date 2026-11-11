// What Gemini must return, twice over: the responseSchema we send it, and the zod schema we check its answer
// against. Field values come back as strings and are coerced here, so one odd value never sinks the whole draft.
import { z } from "zod";
import { LISTING_FIELDS, PROPERTY_TYPES, ROOM_TYPES, SOURCES, type ListingField, type FieldSource } from "./types";

/** Fields Gemini may fill from documents, notes or voice (copy and permit fields are not extracted). */
export const EXTRACT_FIELDS = LISTING_FIELDS.filter(
  (f) => !["title_en", "title_ar", "description_en", "description_ar", "permit_number", "permit_expiry", "agency_orn", "agent_brn", "amenities"].includes(f),
) as Exclude<ListingField, "title_en" | "title_ar" | "description_en" | "description_ar" | "permit_number" | "permit_expiry" | "agency_orn" | "agent_brn" | "amenities">[];

export const NUMBER_FIELDS = new Set<ListingField>(["bedrooms", "bathrooms", "size_sqft", "plot_sqft", "parking", "price", "cheques", "service_charge"]);
export const INTEGER_FIELDS = new Set<ListingField>(["bedrooms", "bathrooms", "parking", "cheques"]);
export const DATE_FIELDS = new Set<ListingField>(["form_a_expiry", "permit_expiry", "handover_date"]);
export const ENUM_FIELDS: Partial<Record<ListingField, readonly string[]>> = {
  offering_type: ["sale", "rent"],
  category: ["residential", "commercial"],
  property_type: PROPERTY_TYPES,
  completion_status: ["ready", "off_plan"],
  furnishing: ["furnished", "semi_furnished", "unfurnished"],
  price_type: ["sale", "yearly", "monthly"],
};

// ---------- Gemini response schemas (OpenAPI subset, upper-case types) ----------
const S = (description?: string) => ({ type: "STRING" as const, ...(description ? { description } : {}) });

export const extractResponseSchema = {
  type: "OBJECT",
  properties: {
    fields: {
      type: "ARRAY",
      description: "One entry per field you found. Leave out fields you could not find. Never guess legal fields.",
      items: {
        type: "OBJECT",
        properties: {
          field: { type: "STRING", enum: [...EXTRACT_FIELDS] },
          value: S("The value as text. Numbers without units or commas. Dates as YYYY-MM-DD. Enums use the listed codes."),
          confidence: { type: "NUMBER", description: "0 to 1. How sure you are the value is correct as written." },
          source: { type: "STRING", enum: [...SOURCES.filter((s) => s !== "agent")] },
          page: { type: "INTEGER", description: "1-based page of the document it came from, if any." },
          snippet: S("The exact words on the document this came from, up to 120 characters."),
        },
        required: ["field", "value", "confidence", "source"],
        propertyOrdering: ["field", "value", "confidence", "source", "page", "snippet"],
      },
    },
    amenities: { type: "ARRAY", items: S(), description: "Amenities stated in the documents, notes or voice. Never from photos." },
    owner: {
      type: "OBJECT",
      properties: { name: S(), idNumber: S("Emirates ID or passport number"), phone: S(), email: S() },
    },
    document_kind: { type: "STRING", enum: ["form_a", "listing_form", "other", "unreadable"] },
    notes: S("Anything odd about the documents, e.g. expired, unsigned, two different unit numbers. Short."),
  },
  required: ["fields", "document_kind"],
} as const;

export const photoResponseSchema = {
  type: "OBJECT",
  properties: {
    photos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER", description: "0-based index of the photo in the order given." },
          room_type: { type: "STRING", enum: [...ROOM_TYPES] },
          quality: { type: "NUMBER", description: "0 to 1, how good this photo is as a listing photo." },
          blurry: { type: "BOOLEAN" }, dark: { type: "BOOLEAN" }, duplicate_of: { type: "INTEGER", description: "Index of an earlier near-identical photo, or -1." },
          watermark: { type: "BOOLEAN" }, phone_visible: { type: "BOOLEAN", description: "A phone number or contact details are visible." },
          people_visible: { type: "BOOLEAN" },
          amenities: { type: "ARRAY", items: S(), description: "Amenities clearly visible (suggestions only)." },
        },
        required: ["index", "room_type", "quality", "blurry", "dark", "duplicate_of", "watermark", "phone_visible", "people_visible"],
      },
    },
    suggested_order: { type: "ARRAY", items: { type: "INTEGER" }, description: "Photo indexes, best listing order first." },
    cover_index: { type: "INTEGER" },
  },
  required: ["photos", "suggested_order", "cover_index"],
} as const;

export const voiceResponseSchema = {
  type: "OBJECT",
  properties: {
    transcript: S("Verbatim transcript, in the language spoken. Arabic stays Arabic."),
    language: S(),
    facts: extractResponseSchema.properties.fields,
    amenities: { type: "ARRAY", items: S() },
  },
  required: ["transcript", "facts"],
} as const;

export const copyResponseSchema = {
  type: "OBJECT",
  properties: {
    title: S("50 characters or fewer."),
    hook: S("One or two sentences."),
    highlights: { type: "ARRAY", items: S(), description: "4 to 8 short bullet points." },
    body: S("The rest of the description, plain sentences."),
  },
  required: ["title", "hook", "highlights", "body"],
} as const;

// ---------- zod: what we accept ----------
const conf = z.coerce.number().catch(0.5).transform((n) => Math.max(0, Math.min(1, n)));
const optStr = z.string().trim().max(500).optional().catch(undefined);

export const extractedFieldSchema = z.object({
  field: z.enum(EXTRACT_FIELDS as [string, ...string[]]),
  value: z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v).trim()),
  confidence: conf,
  source: z.enum(SOURCES as unknown as [string, ...string[]]).catch("inferred"),
  page: z.coerce.number().int().positive().optional().catch(undefined),
  snippet: z.string().trim().max(240).optional().catch(undefined),
});
export type ExtractedField = { field: ListingField; value: string; confidence: number; source: FieldSource; page?: number; snippet?: string };

/** Keep good entries, drop bad ones (a single malformed field shouldn't lose the rest). */
const lenientArray = <T extends z.ZodTypeAny>(item: T) =>
  z.array(z.unknown()).catch([]).transform((arr) => arr.flatMap((x) => {
    const r = item.safeParse(x);
    return r.success ? [r.data as z.infer<T>] : [];
  }));

export const extractionSchema = z.object({
  fields: lenientArray(extractedFieldSchema),
  amenities: z.array(z.string().trim().min(1).max(60)).max(40).catch([]).default([]),
  owner: z.object({ name: optStr, idNumber: optStr, phone: optStr, email: optStr }).partial().catch({}).default({}),
  document_kind: z.enum(["form_a", "listing_form", "other", "unreadable"]).catch("other"),
  notes: z.string().max(1000).optional().catch(undefined),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const photoAnalysisSchema = z.object({
  photos: lenientArray(z.object({
    index: z.coerce.number().int().min(0),
    room_type: z.enum(ROOM_TYPES as unknown as [string, ...string[]]).catch("other"),
    quality: conf,
    blurry: z.boolean().catch(false),
    dark: z.boolean().catch(false),
    duplicate_of: z.coerce.number().int().catch(-1),
    watermark: z.boolean().catch(false),
    phone_visible: z.boolean().catch(false),
    people_visible: z.boolean().catch(false),
    amenities: z.array(z.string().max(60)).catch([]).default([]),
  })),
  suggested_order: z.array(z.coerce.number().int().min(0)).catch([]),
  cover_index: z.coerce.number().int().min(0).catch(0),
});
export type PhotoAnalysis = z.infer<typeof photoAnalysisSchema>;

export const voiceSchema = z.object({
  transcript: z.string().max(20_000).catch(""),
  language: z.string().max(40).optional().catch(undefined),
  facts: lenientArray(extractedFieldSchema),
  amenities: z.array(z.string().max(60)).catch([]).default([]),
});
export type VoiceResult = z.infer<typeof voiceSchema>;

export const copySchema = z.object({
  title: z.string().trim().min(5).max(120),
  hook: z.string().trim().min(10).max(600),
  highlights: z.array(z.string().trim().min(2).max(160)).min(2).max(10),
  body: z.string().trim().max(2000),
});
export type CopyResult = z.infer<typeof copySchema>;

// ---------- coercion of one field value ----------
/** Turn Gemini's text value into the column's type, or undefined when it can't be read. */
export function coerceValue(field: ListingField, raw: string): string | number | null | undefined {
  const v = raw.trim();
  if (!v || /^(n\/?a|null|none|unknown|-)$/i.test(v)) return undefined;
  if (NUMBER_FIELDS.has(field)) {
    if (field === "bedrooms" && /studio/i.test(v)) return 0;
    const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!m) return undefined;
    let n = Number(m[0]);
    if (/\d\s*m\b|\bmn\b|million/i.test(v) && field === "price" && n < 1000) n *= 1_000_000;
    else if (/\d\s*k\b|thousand/i.test(v) && field === "price" && n < 100_000) n *= 1000;
    if (!Number.isFinite(n) || n < 0) return undefined;
    return INTEGER_FIELDS.has(field) ? Math.round(n) : n;
  }
  if (DATE_FIELDS.has(field)) return toIsoDate(v);
  const allowed = ENUM_FIELDS[field];
  if (allowed) {
    const k = v.toLowerCase().replace(/[\s-]+/g, "_");
    const alias: Record<string, string> = {
      rental: "rent", lease: "rent", sell: "sale", offplan: "off_plan", under_construction: "off_plan", completed: "ready",
      semi: "semi_furnished", semifurnished: "semi_furnished", annual: "yearly", per_year: "yearly", year: "yearly", per_month: "monthly", month: "monthly",
      flat: "apartment", "hotel_apt": "hotel_apartment", plot: "land", shop: "retail", building: "full_building",
    };
    const c = alias[k] ?? k;
    return allowed.includes(c) ? c : undefined;
  }
  return v.slice(0, 300);
}

/** "31/12/2026", "2026-12-31", "Dec 31 2026" → "2026-12-31". UAE documents use day-first. */
export function toIsoDate(v: string): string | undefined {
  const s = v.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
function valid(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : undefined;
}

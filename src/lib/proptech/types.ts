// PropTech · Auto Listing shapes shared by the server and the browser (no secrets in here).

export const PROPTECH_FLAG = "proptech_auto_listing";

export const LISTING_STATUSES = ["draft", "processing", "review", "approved", "published", "archived", "failed"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const PORTALS = ["propertyfinder", "bayut", "mock"] as const;
export type Portal = (typeof PORTALS)[number];
export const PORTAL_LABEL: Record<Portal, string> = { propertyfinder: "Property Finder", bayut: "Bayut / dubizzle", mock: "Demo portal" };

/** api = we call the portal; feed = Bayut pulls our XML feed; extension = the agent's Chrome fills the portal's form. */
export type PostMethod = "api" | "feed" | "extension";

export const PORTAL_STATUSES = ["draft", "queued", "submitted", "live", "rejected", "expired", "unpublished"] as const;
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

export const SOURCES = ["form_a", "title_deed", "notes", "voice", "photo", "inferred", "agent"] as const;
export type FieldSource = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<FieldSource, string> = {
  form_a: "Form A", title_deed: "Title deed", notes: "Agent notes", voice: "Voice note", photo: "Photos", inferred: "AI guess", agent: "Edited by you",
};

export const TONES = ["professional", "luxury", "investor"] as const;
export type Tone = (typeof TONES)[number];

export const PROPERTY_TYPES = [
  "apartment", "villa", "townhouse", "penthouse", "duplex", "hotel_apartment", "land", "office", "retail", "warehouse", "full_building", "bulk_units",
] as const;
export const PROPERTY_TYPE_LABEL: Record<string, string> = {
  apartment: "Apartment", villa: "Villa", townhouse: "Townhouse", penthouse: "Penthouse", duplex: "Duplex", hotel_apartment: "Hotel apartment",
  land: "Land", office: "Office", retail: "Retail", warehouse: "Warehouse", full_building: "Full building", bulk_units: "Bulk units",
};
export const EMIRATES = ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Umm Al Quwain", "Fujairah"] as const;
export const ROOM_TYPES = [
  "living_room", "bedroom", "kitchen", "bathroom", "dining", "balcony", "view", "exterior", "building", "pool", "gym", "amenity", "floor_plan", "other",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** Every editable listing field, in the order of the review form. */
export const LISTING_FIELDS = [
  "offering_type", "category", "property_type", "completion_status", "emirate", "community", "sub_community", "building", "unit_number",
  "bedrooms", "bathrooms", "size_sqft", "plot_sqft", "parking", "furnishing", "view", "floor", "amenities",
  "price", "price_type", "cheques", "service_charge", "developer", "handover_date", "payment_plan",
  "form_a_number", "form_a_expiry", "permit_number", "permit_expiry", "agency_orn", "agent_brn",
  "title_en", "title_ar", "description_en", "description_ar",
] as const;
export type ListingField = (typeof LISTING_FIELDS)[number];

/** Fields whose value documents decide (Form A / title deed beat notes and voice). */
export const LEGAL_FIELDS: ListingField[] = [
  "offering_type", "property_type", "emirate", "community", "sub_community", "building", "unit_number", "size_sqft", "plot_sqft",
  "bedrooms", "price", "price_type", "form_a_number", "form_a_expiry", "developer",
];
/** Fields where the agent's own words (notes, voice) beat documents. */
export const MARKETING_FIELDS: ListingField[] = ["view", "furnishing", "amenities", "payment_plan", "floor", "parking", "cheques", "completion_status", "handover_date", "bathrooms", "service_charge"];

export interface Listing {
  id: string;
  workspaceId: string;
  createdBy: string;
  agentId: string | null;
  status: ListingStatus;
  offering_type: "sale" | "rent" | null;
  category: "residential" | "commercial" | null;
  property_type: string | null;
  completion_status: "ready" | "off_plan" | null;
  emirate: string | null;
  community: string | null;
  sub_community: string | null;
  building: string | null;
  unit_number: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqft: number | null;
  plot_sqft: number | null;
  parking: number | null;
  furnishing: "furnished" | "semi_furnished" | "unfurnished" | null;
  view: string | null;
  floor: string | null;
  amenities: string[];
  price: number | null;
  price_type: "sale" | "yearly" | "monthly" | null;
  cheques: number | null;
  service_charge: number | null;
  developer: string | null;
  handover_date: string | null;
  payment_plan: string | null;
  permit_number: string | null;
  permit_expiry: string | null;
  agency_orn: string | null;
  agent_brn: string | null;
  form_a_number: string | null;
  form_a_expiry: string | null;
  title_en: string | null;
  title_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  tone: Tone;
  fieldConfidence: Partial<Record<ListingField, number>>;
  fieldSource: Partial<Record<ListingField, SourceRef>>;
  aiQuestions: AiQuestion[];
  progress: Progress;
  aiCostUsd: number;
  aiTokens: number;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRef { source: FieldSource; page?: number; snippet?: string; mediaId?: string }
export interface AiQuestion { field: ListingField; question: string; options: string[] }
export interface Progress { step?: string; label?: string; done?: string[]; error?: string; startedAt?: string; finishedAt?: string }

/** Owner details from Form A. Stored encrypted, never sent to portals, masked for non-admins. */
export interface OwnerPii { name?: string; idNumber?: string; phone?: string; email?: string }

export interface MediaFlags {
  blurry?: boolean; dark?: boolean; duplicate?: boolean; watermark?: boolean; phone_visible?: boolean; people_visible?: boolean; low_res?: boolean;
  /** 0–1 from the photo analysis. */
  quality?: number;
  /** Amenities the AI could see (suggestions only, never added automatically). */
  amenity_suggestions?: string[];
}
export interface ListingMedia {
  id: string;
  kind: "photo" | "floorplan" | "form_a" | "document" | "audio";
  docType: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  roomType: string | null;
  order: number;
  isCover: boolean;
  removed: boolean;
  flags: MediaFlags;
  /** Short-lived signed URL. */
  url?: string;
}

export interface PortalListing {
  portal: Portal;
  externalId: string | null;
  status: PortalStatus;
  lastError: PortalError | null;
  lastSyncedAt: string | null;
}
export interface PortalError { code?: string; message: string; plain: string; field?: ListingField }

export interface PortalEvent {
  id: number; portal: string; action: string; ok: boolean; error: string | null; durationMs: number | null; createdAt: string;
  request?: unknown; response?: unknown;
}
export interface AuditEntry { id: number; actor: string; action: string; detail: Record<string, unknown>; createdAt: string }

export interface ValidationIssue { field?: ListingField | "photos" | "cover"; message: string; level: "error" | "confirm" | "warning"; portal?: Portal }
export interface ValidationResult { ok: boolean; issues: ValidationIssue[] }

/** What the Listing Detail screen gets. */
export interface ListingBundle {
  listing: Listing;
  media: ListingMedia[];
  inputs: { agentNotes: string; voiceTranscript: string };
  owner: OwnerPii | null;
  ownerMasked: boolean;
  portals: PortalListing[];
  connectedPortals: Portal[];
  /** How each portal is reached: our API, the Bayut feed, or the Chrome extension. */
  methods: Partial<Record<Portal, PostMethod>>;
  validation: ValidationResult;
  events: PortalEvent[];
  audit: AuditEntry[];
  usage: { task: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; ok: boolean; createdAt: string }[];
  canAdmin: boolean;
  /** The listing agent's details shown to buyers (from Portal Settings). */
  agent: { name?: string; phone?: string; email?: string };
}

export interface ListingSummary {
  id: string; status: ListingStatus; title: string; community: string | null; propertyType: string | null; price: number | null;
  priceType: string | null; offeringType: string | null; agentId: string | null; createdBy: string; coverUrl?: string;
  portals: { portal: Portal; status: PortalStatus }[]; createdAt: string; updatedAt: string; aiCostUsd: number;
}

/** Portal Settings as the browser sees them (no credentials). */
export interface PortalConnectionView {
  portal: Portal;
  enabled: boolean;
  mode: "sandbox" | "live";
  hasCredentials: boolean;
  feedUrl?: string;
  lastFetchedAt?: string | null;
  lastGeneratedAt?: string | null;
  lastFeedError?: string | null;
  defaults: PortalDefaults;
}
export interface PortalDefaults {
  orn?: string;
  agents?: Record<string, { brn?: string; portalAgentId?: string; name?: string; email?: string; phone?: string }>;
  mock?: { rejectFirst?: boolean; delayMs?: number };
}

export const fmtAed = (n: number | null | undefined) => (n == null ? "—" : `AED ${Math.round(n).toLocaleString("en-US")}`);

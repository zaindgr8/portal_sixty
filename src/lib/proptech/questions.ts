// "AI asks" chips: one quick question per missing required field, with quick-tap answers.
// Built from the validation rules (instant and free); wording rules in prompts/proptech/missing_field_questions.md.
import type { AiQuestion, Listing, ListingField } from "./types";
import { requiredFields } from "./validate";

const Q: Partial<Record<ListingField, { question: string; options: string[] }>> = {
  offering_type: { question: "For sale or for rent?", options: ["sale", "rent"] },
  property_type: { question: "What type of property?", options: ["apartment", "villa", "townhouse", "penthouse", "office", "Other…"] },
  bedrooms: { question: "Bedrooms?", options: ["0", "1", "2", "3", "4", "5+"] },
  bathrooms: { question: "Bathrooms?", options: ["1", "2", "3", "4", "5+"] },
  parking: { question: "Parking spaces?", options: ["0", "1", "2", "3+"] },
  furnishing: { question: "Furnished?", options: ["unfurnished", "semi_furnished", "furnished"] },
  price_type: { question: "Rent per year or per month?", options: ["yearly", "monthly"] },
  cheques: { question: "How many cheques?", options: ["1", "2", "4", "6", "12"] },
  completion_status: { question: "Ready or off-plan?", options: ["ready", "off_plan"] },
  community: { question: "Which community?", options: ["Other…"] },
  size_sqft: { question: "Size in sqft?", options: ["Other…"] },
  price: { question: "Asking price (AED)?", options: ["Other…"] },
  handover_date: { question: "Expected handover?", options: ["Other…"] },
  developer: { question: "Who is the developer?", options: ["Emaar", "DAMAC", "Nakheel", "Sobha", "Meraas", "Other…"] },
  agent_brn: { question: "Your BRN (RERA broker number)?", options: ["Other…"] },
  agency_orn: { question: "Agency ORN?", options: ["Other…"] },
};

// Copy and permit fields have their own blocks on the review screen.
const SKIP = new Set<ListingField>(["title_en", "description_en", "title_ar", "description_ar", "permit_number", "permit_expiry"]);

export function missingQuestions(l: Listing): AiQuestion[] {
  const want = new Set<ListingField>([...requiredFields(l), "parking", "furnishing"]);
  if (l.offering_type === "rent") want.add("cheques");
  const out: AiQuestion[] = [];
  for (const f of want) {
    if (SKIP.has(f)) continue;
    const v = l[f];
    if (v !== null && v !== undefined && v !== "") continue;
    const q = Q[f];
    if (q) out.push({ field: f, question: q.question, options: q.options });
  }
  return out;
}

/** Turn a chip answer into the value to save ("5+" → 5, "3+" → 3). */
export function chipValue(field: ListingField, option: string): string | number {
  if (/^\d+\+?$/.test(option)) return Number(option.replace("+", ""));
  return option;
}

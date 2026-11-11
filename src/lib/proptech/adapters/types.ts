// The contract every portal integration fulfils. Publishing code only talks to this interface.
import type { Listing, ListingMedia, Portal, PortalDefaults, PortalError, PortalStatus, ValidationIssue } from "../types";
import type { PortalConnection } from "../store";

export interface AdapterContext {
  workspaceId: string;
  connection: PortalConnection;
  /** Called for every outbound request so it lands in portal_events. */
  log: (e: { action: string; ok: boolean; request?: unknown; response?: unknown; error?: string; durationMs?: number }) => Promise<void>;
}

export interface PublishInput {
  listing: Listing;
  photos: ListingMedia[];
  /** Absolute URLs a portal can fetch the photos from (in display order). */
  photoUrls: string[];
  externalId: string | null;
  agent: NonNullable<PortalDefaults["agents"]>[string] & { username?: string };
}

export interface PublishResult {
  status: PortalStatus;
  externalId?: string | null;
  error?: PortalError;
  /** Ask the job runner to call getStatus again after this many ms. */
  checkAgainInMs?: number;
}

export interface PortalAdapter {
  portal: Portal;
  /** Portal-specific checks on top of the shared validation. */
  validate(input: PublishInput, ctx: AdapterContext): Promise<ValidationIssue[]>;
  publish(input: PublishInput, ctx: AdapterContext): Promise<PublishResult>;
  update(input: PublishInput, ctx: AdapterContext): Promise<PublishResult>;
  unpublish(input: PublishInput, ctx: AdapterContext): Promise<PublishResult>;
  getStatus(input: PublishInput, ctx: AdapterContext): Promise<PublishResult>;
  /** Leads from the portal (stub; follow-up by the Sixty AI WhatsApp/voice agent comes later). */
  fetchLeads(ctx: AdapterContext, since?: Date): Promise<{ leads: unknown[] }>;
}

/** Portal error text → plain English + the field to fix. Shared by adapters. */
export function translateError(message: string, code?: string): PortalError {
  const m = message.toLowerCase();
  const rules: [RegExp, string, PortalError["field"]][] = [
    [/permit|trakheesi|rera|dld/, "The portal couldn't match the Trakheesi permit. Check the permit number and expiry match the DLD record for this unit.", "permit_number"],
    [/brn|broker/, "The agent's BRN wasn't accepted. Check it's the agent's current RERA broker number.", "agent_brn"],
    [/orn/, "The agency ORN wasn't accepted.", "agency_orn"],
    [/image|photo|picture|resolution/, "One or more photos were rejected. Replace small, blurry or watermarked photos.", undefined],
    [/description/, "The description was rejected. Remove contact details and keep it within the length limit.", "description_en"],
    [/title/, "The title was rejected. Keep it under 50 characters with no contact details.", "title_en"],
    [/price/, "The price was rejected. Check the amount and the rent period.", "price"],
    [/location|community|locality/, "The portal didn't recognise the location. Check the community and building names.", "community"],
    [/size|area/, "The size was rejected. Check it's in square feet.", "size_sqft"],
    [/duplicate/, "The portal says this listing already exists.", undefined],
    [/auth|unauthori|forbidden|401|403|token/, "The portal rejected our API keys. An admin should check Portal Settings.", undefined],
  ];
  for (const [re, plain, field] of rules) if (re.test(m)) return { code, message, plain, field };
  return { code, message, plain: `The portal said: ${message}` };
}

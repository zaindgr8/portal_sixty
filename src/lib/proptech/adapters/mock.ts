import "server-only";
import { sb, q } from "../../supabase";
import type { PortalAdapter, PublishInput, AdapterContext, PublishResult } from "./types";

// A pretend portal for development and client demos. It behaves like a real one: publishing is accepted
// ("submitted"), goes live a few seconds later, and — when "reject first" is on in Portal Settings — the first
// submission of each listing is rejected over its permit, so the fix → republish → live loop can be shown.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function priorRejections(ws: string, listingId: string) {
  const rows = await sb<{ id: number }[]>(`portal_events?workspace_id=eq.${q(ws)}&listing_id=eq.${q(listingId)}&portal=eq.mock&action=eq.publish&ok=eq.false&select=id&limit=1`);
  return rows.length;
}

async function call(ctx: AdapterContext, action: string, request: unknown, fn: () => Promise<PublishResult>) {
  const t = Date.now();
  await sleep(Math.min(ctx.connection.defaults.mock?.delayMs ?? 600, 5000));
  const r = await fn();
  await ctx.log({ action, ok: !r.error, request, response: r, error: r.error?.message, durationMs: Date.now() - t });
  return r;
}

const summary = (i: PublishInput) => ({ ref: i.listing.id, title: i.listing.title_en, price: i.listing.price, permit: i.listing.permit_number, photos: i.photoUrls.length });

export const mockAdapter: PortalAdapter = {
  portal: "mock",
  async validate() { return []; },
  async publish(i, ctx) {
    return call(ctx, "publish", summary(i), async () => {
      if (ctx.connection.defaults.mock?.rejectFirst !== false && !(await priorRejections(ctx.workspaceId, i.listing.id))) {
        return {
          status: "rejected",
          error: { code: "PERMIT_MISMATCH", message: "Permit number does not match DLD Trakheesi records for this unit (demo rejection).", plain: "The portal couldn't match the Trakheesi permit. Check the permit number and expiry match the DLD record for this unit.", field: "permit_number" },
        };
      }
      return { status: "submitted", externalId: i.externalId ?? `MOCK-${i.listing.id.slice(0, 8).toUpperCase()}`, checkAgainInMs: 6000 };
    });
  },
  async update(i, ctx) {
    return call(ctx, "update", summary(i), async () => ({ status: "submitted", externalId: i.externalId ?? `MOCK-${i.listing.id.slice(0, 8).toUpperCase()}`, checkAgainInMs: 4000 }));
  },
  async unpublish(i, ctx) {
    return call(ctx, "unpublish", { ref: i.listing.id, externalId: i.externalId }, async () => ({ status: "unpublished", externalId: i.externalId }));
  },
  async getStatus(i, ctx) {
    return call(ctx, "status", { externalId: i.externalId }, async () => ({ status: "live", externalId: i.externalId }));
  },
  async fetchLeads() { return { leads: [] }; },
};

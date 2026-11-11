import "server-only";
import { enqueue, type Job } from "./jobs";
import { mockAdapter } from "./adapters/mock";
import { bayutAdapter, bayutMapping, forgetFeed } from "./adapters/bayut";
import { pfMapping, pfMissing, propertyFinderAdapter } from "./adapters/propertyfinder";
import type { AdapterContext, PortalAdapter, PublishInput } from "./adapters/types";
import { signUrls } from "./storage";
import {
  audit, getConnection, getListing, listConnections, listMediaRows, listPortalListings, logPortalEvent, setPortalListing, toMedia, updateListing,
  type PortalConnection,
} from "./store";
import { validateListing, type PortalRules } from "./validate";
import { EXT_PENDING, isAgentPosted } from "./manual";
import { PORTAL_LABEL, type Listing, type Portal, type PostMethod, type ValidationResult } from "./types";

export const ADAPTERS: Record<Portal, PortalAdapter> = { mock: mockAdapter, bayut: bayutAdapter, propertyfinder: propertyFinderAdapter };

export function portalRules(): Partial<Record<Portal, PortalRules>> {
  const read = (f: () => { rules?: PortalRules }) => { try { return f().rules ?? {}; } catch { return {}; } };
  return { bayut: read(bayutMapping), propertyfinder: read(pfMapping as () => { rules?: PortalRules }) };
}

/**
 * How each portal is reached. Property Finder goes through its API once keys are saved and the API mapping is
 * verified; Bayut through the XML feed once it's switched on. Until then both are posted by the agent's Chrome
 * with the Sixty extension. The demo portal is available until a real one is connected (and always in dev).
 */
export async function portalMethods(ws: string): Promise<Partial<Record<Portal, PostMethod>>> {
  const conns = await listConnections(ws);
  const get = (p: Portal) => conns.find((c) => c.portal === p);
  const pf = get("propertyfinder"), bayut = get("bayut"), mockRow = get("mock");
  const pfApi = Boolean(pf?.enabled && pf.credentials?.apiKey && pf.credentials?.apiSecret && !pfMissing().length);
  const feed = Boolean(bayut?.enabled && bayut.feedToken);
  const realOn = Boolean(pf?.enabled || bayut?.enabled);
  const mock = mockRow ? mockRow.enabled : !realOn || process.env.NODE_ENV !== "production";
  return { propertyfinder: pfApi ? "api" : "extension", bayut: feed ? "feed" : "extension", ...(mock ? { mock: "api" as const } : {}) };
}

/** Portals this agency can publish to (every portal with a way in). */
export async function connectedPortals(ws: string): Promise<Portal[]> {
  return Object.keys(await portalMethods(ws)) as Portal[];
}

async function connectionFor(ws: string, portal: Portal): Promise<PortalConnection> {
  return (await getConnection(ws, portal)) ?? { portal, enabled: true, mode: "sandbox", credentials: null, feedToken: null, defaults: { mock: { rejectFirst: true, delayMs: 800 } } };
}

export async function validateFor(ws: string, l: Listing, portals: Portal[]): Promise<ValidationResult> {
  const media = (await listMediaRows(ws, l.id)).map(toMedia);
  return validateListing({ listing: l, media, portals, rules: portalRules() });
}

async function buildInput(ws: string, l: Listing, portal: Portal, conn: PortalConnection): Promise<PublishInput> {
  const rows = await listMediaRows(ws, l.id);
  const photosRows = rows.filter((r) => r.kind === "photo" && !r.removed).sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || Number(a.sort_order) - Number(b.sort_order));
  // Portals download photos after we submit, so give them a week.
  const urls = await signUrls(ws, photosRows.map((r) => String(r.path)), 7 * 24 * 3600);
  const existing = (await listPortalListings(ws, l.id)).find((p) => p.portal === portal);
  const agent = { ...(conn.defaults.agents?.[l.agentId ?? ""] ?? {}), username: l.agentId ?? undefined };
  return { listing: l, photos: photosRows.map(toMedia), photoUrls: photosRows.map((r) => urls.get(String(r.path)) ?? ""), externalId: existing?.externalId ?? null, agent };
}

function ctxFor(ws: string, listingId: string, conn: PortalConnection): AdapterContext {
  return { workspaceId: ws, connection: conn, log: (e) => logPortalEvent(ws, { listingId, portal: conn.portal, ...e }) };
}

/** Approve and queue one publish job per portal. Returns the validation result (nothing is queued if it fails). */
export async function requestPublish(ws: string, actor: string, listingId: string, portals: Portal[], action: "publish" | "update" = "publish", confirm = false) {
  const l = await getListing(ws, listingId);
  if (!l) throw new Error("Listing not found.");
  const methods = await portalMethods(ws);
  const chosen = [...new Set(portals)].filter((p) => methods[p]);
  if (!chosen.length) return { ok: false, issues: [{ level: "error" as const, message: "Pick at least one connected portal." }] };
  const v = await validateFor(ws, l, chosen);
  // Adapter-specific checks (e.g. PF needs the agent linked to a PF user).
  for (const p of chosen.filter((x) => methods[x] !== "extension")) {
    const conn = await connectionFor(ws, p);
    const extra = await ADAPTERS[p].validate(await buildInput(ws, l, p, conn), ctxFor(ws, l.id, conn));
    v.issues.push(...extra);
  }
  v.ok = !v.issues.some((i) => i.level === "error");
  if (!v.ok) return v;
  // Price-sanity and similar checks need the agent to confirm before anything is sent.
  if (!confirm && v.issues.some((i) => i.level === "confirm")) return { ...v, ok: false, needsConfirm: true };
  if (l.status !== "published") await updateListing(ws, l.id, { status: "approved", approved_at: new Date().toISOString(), approved_by: actor });
  for (const p of chosen) {
    if (methods[p] === "extension") {
      // Waits in the agent's Sixty extension, which fills the portal's own form in their Chrome.
      const existing = (await listPortalListings(ws, l.id)).find((x) => x.portal === p);
      const keep = existing?.externalId && existing.externalId !== EXT_PENDING && action === "update" ? existing.externalId : EXT_PENDING;
      await setPortalListing(ws, l.id, p, { status: "queued", externalId: keep, lastError: null });
      await logPortalEvent(ws, { listingId: l.id, portal: p, action: "queued_for_extension", ok: true, request: { by: actor, action } });
      continue;
    }
    await setPortalListing(ws, l.id, p, { status: "queued", lastError: null });
    await enqueue(ws, action === "update" ? "portal_update" : "portal_publish", { listingId: l.id, payload: { portal: p, actor } });
  }
  await audit(ws, l.id, actor, action, { portals: chosen });
  return v;
}

export async function requestUnpublish(ws: string, actor: string, listingId: string, portals: Portal[]) {
  const current = await listPortalListings(ws, listingId);
  const active = current.filter((p) => portals.includes(p.portal) && !["unpublished", "draft"].includes(p.status));
  const chosen = active.map((p) => p.portal);
  for (const pl of active) {
    const p = pl.portal;
    // Posted by hand: the agent takes it down on the portal; we just record it.
    if (isAgentPosted(pl.externalId)) { await setPortalListing(ws, listingId, p, { status: "unpublished" }); continue; }
    await setPortalListing(ws, listingId, p, { status: "queued" });
    await enqueue(ws, "portal_unpublish", { listingId, payload: { portal: p, actor } });
  }
  await audit(ws, listingId, actor, "unpublish", { portals: chosen });
  return chosen;
}

// ---------- job handlers ----------
export async function runPortalJob(job: Job): Promise<void | { retryInMs?: number }> {
  const ws = job.workspace_id;
  const portal = job.payload.portal as Portal;
  const l = job.listing_id ? await getListing(ws, job.listing_id) : null;
  if (!l || !ADAPTERS[portal]) return;
  const conn = await connectionFor(ws, portal);
  const input = await buildInput(ws, l, portal, conn);
  const ctx = ctxFor(ws, l.id, conn);
  const adapter = ADAPTERS[portal];
  const r = job.kind === "portal_publish" ? await adapter.publish(input, ctx)
    : job.kind === "portal_update" ? await adapter.update(input, ctx)
    : job.kind === "portal_unpublish" ? await adapter.unpublish(input, ctx)
    : await adapter.getStatus(input, ctx);
  await setPortalListing(ws, l.id, portal, { status: r.status, externalId: r.externalId ?? input.externalId, lastError: r.error ?? (r.status === "rejected" ? null : null) });
  if (portal === "bayut") forgetFeed(ws);
  // The listing counts as published while it's submitted or live anywhere.
  const all = await listPortalListings(ws, l.id);
  const anyLive = all.some((p) => ["submitted", "live"].includes(p.status));
  if (anyLive && l.status !== "published") await updateListing(ws, l.id, { status: "published" });
  if (!anyLive && l.status === "published") await updateListing(ws, l.id, { status: "approved" });
  if (r.checkAgainInMs && r.status === "submitted") {
    if (job.kind === "portal_status") return { retryInMs: r.checkAgainInMs };
    await enqueue(ws, "portal_status", { listingId: l.id, payload: { portal }, delayMs: r.checkAgainInMs, maxAttempts: 20 });
  }
}

/** A portal job that kept failing (network, portal down): show it on the listing instead of leaving it "queued". */
export async function portalJobFailed(job: Job, msg: string) {
  if (!job.listing_id || !String(job.kind).startsWith("portal_")) return;
  const portal = job.payload.portal as Portal;
  await setPortalListing(job.workspace_id, job.listing_id, portal, {
    status: "rejected", lastError: { code: "UNREACHABLE", message: msg, plain: `We couldn't reach ${PORTAL_LABEL[portal] ?? portal} after several tries. Try again in a few minutes.` },
  });
}

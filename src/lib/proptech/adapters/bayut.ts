import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { q, sb } from "../../supabase";
import { publicBaseUrl } from "../../tenant/workspaces";
import { originOf } from "../../tenant/api";
import { getConnection, listAgents, logPortalEvent, toListing, toMedia } from "../store";
import { buildFeedXml, checkXml, feedEligible, type FeedMapping } from "./feed";
import type { PortalAdapter } from "./types";
import type { Listing, ListingMedia } from "../types";

// Bayut and dubizzle pull a public XML feed the agency registers with them. One feed per agency at
// /feeds/bayut/{agencyId}/{token}.xml, generated from the database and cached for 5 minutes. If a new
// feed fails its checks we keep serving the last good one and record the error for the admins.
const TTL = 5 * 60_000;
const g = globalThis as typeof globalThis & { __bayutFeed?: Map<string, { at: number; xml: string }> };
const mem = (g.__bayutFeed ??= new Map());
export const forgetFeed = (ws: string) => mem.delete(ws);

export function bayutMapping(): FeedMapping {
  return JSON.parse(readFileSync(path.join(process.cwd(), "mappings", "bayut.json"), "utf8")) as FeedMapping;
}

export const newFeedToken = () => randomBytes(24).toString("base64url");
export const feedUrl = (ws: string, token: string, origin?: string) => `${(publicBaseUrl() || origin || "").replace(/\/$/, "")}/feeds/bayut/${encodeURIComponent(ws)}/${token}.xml`;
const imageUrl = (ws: string, token: string, m: ListingMedia, origin = "") => `${publicBaseUrl() || origin}/feeds/bayut/${encodeURIComponent(ws)}/${token}/media/${m.id}`;

function tokenMatches(saved: string | null, given: string) {
  if (!saved) return false;
  const a = Buffer.from(saved), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The agency's connection, if this token is its current feed token and the feed is switched on. */
export async function feedOwner(agencyId: string, token: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(agencyId) || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const conn = await getConnection(agencyId, "bayut").catch(() => null);
  if (!conn || !conn.enabled || !tokenMatches(conn.feedToken, token)) return null;
  return conn;
}

type Row = Record<string, unknown>;

/** Listings marked for Bayut (and not unpublished), with their media. */
async function feedCandidates(ws: string) {
  const marks = (await sb<{ listing_id: string; external_id: string | null }[]>(`portal_listings?workspace_id=eq.${q(ws)}&portal=eq.bayut&status=in.(queued,submitted,live)&select=listing_id,external_id`))
    .filter((m) => !m.external_id?.startsWith("manual:") && !m.external_id?.startsWith("ext:"));
  if (!marks.length) return [];
  const ids = marks.map((m) => m.listing_id).join(",");
  const [rows, media] = await Promise.all([
    sb<Row[]>(`listings?workspace_id=eq.${q(ws)}&id=in.(${ids})&status=in.(approved,published)&select=*`),
    sb<Row[]>(`listing_media?workspace_id=eq.${q(ws)}&listing_id=in.(${ids})&removed=eq.false&select=*&order=sort_order.asc`),
  ]);
  return rows.map((r) => ({ listing: toListing(r), media: media.filter((m) => m.listing_id === r.id).map(toMedia) }));
}

/** Build, check and store the agency's feed. Returns the XML to serve (the last good one on failure). */
export async function generateFeed(ws: string, token: string, origin = ""): Promise<{ xml: string; fresh: boolean; error?: string }> {
  const t = Date.now();
  const conn = await getConnection(ws, "bayut");
  let included: Listing[] = [];
  let skipped: { id: string; reason: string }[] = [];
  try {
    const mapping = bayutMapping();
    const agents = Object.fromEntries((await listAgents(ws)).map((a) => [a.username, { name: a.display_name || a.username, email: a.email ?? undefined }]));
    const items = await feedCandidates(ws);
    const ctx = { mapping, defaults: conn?.defaults ?? {}, imageUrl: (m: ListingMedia) => imageUrl(ws, token, m, origin), agentNames: agents };
    const e = feedEligible(items, ctx);
    skipped = e.skipped;
    included = e.ok.map((x) => x.listing);
    const xml = buildFeedXml(e.ok, ctx);
    const bad = checkXml(xml);
    if (bad) throw new Error(`Generated feed is not valid XML: ${bad}`);
    await sb("bayut_feed_cache?on_conflict=workspace_id", {
      method: "POST", prefer: "resolution=merge-duplicates",
      body: { workspace_id: ws, xml, listing_count: e.ok.length, generated_at: new Date().toISOString(), last_error: null },
    });
    await logPortalEvent(ws, { portal: "bayut", action: "feed_generate", ok: true, response: { included: included.map((l) => l.id), skipped }, durationMs: Date.now() - t });
    return { xml, fresh: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[proptech:bayut] feed for ${ws} failed, serving last good feed: ${msg}`);
    await sb(`bayut_feed_cache?workspace_id=eq.${q(ws)}`, { method: "PATCH", body: { last_error: msg.slice(0, 1000), last_error_at: new Date().toISOString() } }).catch(() => {});
    await logPortalEvent(ws, { portal: "bayut", action: "feed_generate", ok: false, error: msg, response: { skipped }, durationMs: Date.now() - t });
    const last = (await sb<{ xml: string }[]>(`bayut_feed_cache?workspace_id=eq.${q(ws)}&select=xml`))[0];
    return { xml: last?.xml ?? emptyFeed(), fresh: false, error: msg };
  }
}

const emptyFeed = () => {
  const m = bayutMapping();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${m.root} count="0">\n</${m.root}>`;
};

/** What the public feed URL returns. Logs every fetch ("last fetched by Bayut"). */
export async function serveFeed(ws: string, token: string, req: Request) {
  const hit = mem.get(ws);
  let xml: string;
  let cached = false;
  if (hit && Date.now() - hit.at < TTL) { xml = hit.xml; cached = true; }
  else {
    xml = (await generateFeed(ws, token, originOf(req))).xml;
    mem.set(ws, { at: Date.now(), xml });
  }
  const now = new Date().toISOString();
  await logPortalEvent(ws, {
    portal: "bayut", action: "feed_fetch", ok: true,
    request: { ua: req.headers.get("user-agent")?.slice(0, 200), ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null, cached },
  });
  await sb(`bayut_feed_cache?workspace_id=eq.${q(ws)}`, { method: "PATCH", body: { last_fetched_at: now } }).catch(() => {});
  // Listings that were waiting for Bayut to pick them up are now in a fetched feed.
  const refEl = Object.entries(bayutMapping().fields).find(([, src]) => src === "ref")?.[0] ?? "Property_Ref_No";
  const refs = [...xml.matchAll(new RegExp(`<${refEl}>([0-9a-f-]{36})</${refEl}>`, "g"))].map((m) => m[1]);
  if (refs.length) {
    await sb(`portal_listings?workspace_id=eq.${q(ws)}&portal=eq.bayut&status=in.(queued,submitted)&listing_id=in.(${refs.join(",")})`, {
      method: "PATCH", body: { status: "live", last_synced_at: now, last_error: null, updated_at: now },
    }).catch(() => {});
  }
  return xml;
}

/** Is this photo in the agency's current feed? (Photos are served to Bayut through the feed token, never public.) */
export async function feedMedia(ws: string, mediaId: string) {
  if (!/^[0-9a-f-]{36}$/.test(mediaId)) return null;
  const m = (await sb<Row[]>(`listing_media?workspace_id=eq.${q(ws)}&id=eq.${q(mediaId)}&kind=eq.photo&removed=eq.false&select=path,mime_type,listing_id`))[0];
  if (!m) return null;
  const mark = await sb<Row[]>(`portal_listings?workspace_id=eq.${q(ws)}&listing_id=eq.${q(String(m.listing_id))}&portal=eq.bayut&status=in.(queued,submitted,live)&select=id`);
  return mark.length ? { path: String(m.path), mime: String(m.mime_type || "image/jpeg") } : null;
}

export const bayutAdapter: PortalAdapter = {
  portal: "bayut",
  async validate() { return []; },
  async publish(i, ctx) {
    forgetFeed(ctx.workspaceId);
    await ctx.log({ action: "publish", ok: true, request: { ref: i.listing.id }, response: { note: "Added to the Bayut feed. It goes live when Bayut next fetches the feed." } });
    return { status: "submitted", externalId: i.listing.id };
  },
  async update(i, ctx) {
    forgetFeed(ctx.workspaceId);
    await ctx.log({ action: "update", ok: true, request: { ref: i.listing.id }, response: { note: "Feed updated; Bayut picks it up on the next fetch." } });
    return { status: "submitted", externalId: i.listing.id };
  },
  async unpublish(i, ctx) {
    forgetFeed(ctx.workspaceId);
    await ctx.log({ action: "unpublish", ok: true, request: { ref: i.listing.id }, response: { note: "Removed from the feed." } });
    return { status: "unpublished", externalId: i.externalId };
  },
  async getStatus(i) {
    return { status: "submitted", externalId: i.externalId };
  },
  async fetchLeads() { return { leads: [] }; },
};

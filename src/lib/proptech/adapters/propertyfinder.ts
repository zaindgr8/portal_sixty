import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { q, sb } from "../../supabase";
import { translateError, type AdapterContext, type PortalAdapter, type PublishInput, type PublishResult } from "./types";
import type { PortalStatus } from "../types";

// Property Finder Enterprise API 2.0. Each agency's Decision Maker creates an API key + secret in PF Expert
// (Developer Resources → API Credentials) and pastes them in Portal Settings; sandbox is the default.
//
// We don't guess PF's endpoints or field names: they come from mappings/propertyfinder.json, copied from the
// official docs. Until that file says verified: true the adapter refuses to call PF and says what's missing.

interface PfMapping {
  verified: boolean;
  baseUrl: { sandbox: string | null; live: string | null };
  auth: { tokenEndpoint: string | null; keyField: string | null; secretField: string | null; tokenTtlSeconds: number | null };
  endpoints: Record<"createListing" | "updateListing" | "publishListing" | "unpublishListing" | "getListing" | "locationsSearch" | "leads", string | null>;
  fields: Record<string, string>;
  values: Record<string, Record<string, string>>;
  statusMap: Record<string, string>;
  idPath?: string;
  statusPath?: string;
  errorPath?: string;
}

export function pfMapping(): PfMapping {
  return JSON.parse(readFileSync(path.join(process.cwd(), "mappings", "propertyfinder.json"), "utf8")) as PfMapping;
}

/** What still has to be copied from PF's docs before real calls are made (empty = ready). */
export function pfMissing(m = pfMapping()): string[] {
  const miss: string[] = [];
  if (!m.verified) miss.push("mappings/propertyfinder.json is not marked verified");
  if (!m.baseUrl.sandbox) miss.push("sandbox base URL");
  if (!m.auth.tokenEndpoint) miss.push("auth token endpoint and body field names");
  for (const k of ["createListing", "updateListing", "publishListing", "unpublishListing", "getListing", "locationsSearch"] as const) if (!m.endpoints[k]) miss.push(`${k} endpoint`);
  if (Object.keys(m.fields).filter((k) => !k.startsWith("_")).length < 8) miss.push("listing field names");
  return miss;
}

const g = globalThis as typeof globalThis & { __pfTokens?: Map<string, { token: string; exp: number }> };
const tokens = (g.__pfTokens ??= new Map());

const dig = (o: unknown, p?: string) => (p ? p.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o) : undefined);
const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(vars[k] ?? ""));

class PfClient {
  constructor(private m: PfMapping, private ctx: AdapterContext) {}
  private get base() {
    const b = this.ctx.connection.mode === "live" ? this.m.baseUrl.live : this.m.baseUrl.sandbox;
    if (!b) throw new Error(`Property Finder ${this.ctx.connection.mode} base URL isn't set in mappings/propertyfinder.json.`);
    return b.replace(/\/$/, "");
  }
  private async token() {
    const key = `${this.ctx.workspaceId}:${this.ctx.connection.mode}`;
    const hit = tokens.get(key);
    if (hit && hit.exp > Date.now() + 30_000) return hit.token;
    const c = this.ctx.connection.credentials ?? {};
    if (!c.apiKey || !c.apiSecret) throw new Error("Property Finder API key and secret aren't saved in Portal Settings.");
    const a = this.m.auth;
    const res = await this.raw("auth", "POST", a.tokenEndpoint!, { [a.keyField ?? "apiKey"]: c.apiKey, [a.secretField ?? "apiSecret"]: c.apiSecret }, false);
    const token = String(dig(res, "accessToken") ?? dig(res, "access_token") ?? dig(res, "token") ?? "");
    if (!token) throw new Error("Property Finder didn't return an access token.");
    tokens.set(key, { token, exp: Date.now() + (Number(dig(res, "expiresIn") ?? dig(res, "expires_in")) || this.m.auth.tokenTtlSeconds || 1800) * 1000 });
    return token;
  }
  async raw(action: string, method: string, endpoint: string, body?: unknown, auth = true): Promise<unknown> {
    const t = Date.now();
    const url = endpoint.startsWith("http") ? endpoint : `${this.base}${endpoint}`;
    let status = 0, json: unknown = null, error: string | undefined;
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(auth ? { Authorization: `Bearer ${await this.token()}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      status = res.status;
      const text = await res.text();
      try { json = text ? JSON.parse(text) : null; } catch { json = { text: text.slice(0, 2000) }; }
      if (!res.ok) error = String(dig(json, this.m.errorPath ?? "message") ?? dig(json, "error.message") ?? dig(json, "detail") ?? `HTTP ${status}`);
      return error ? Promise.reject(Object.assign(new Error(error), { status, json })) : json;
    } catch (err) {
      error ??= err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      await this.ctx.log({ action, ok: !error, request: { method, url, body: action === "auth" ? "[redacted]" : body }, response: { status, body: json }, error, durationMs: Date.now() - t });
    }
  }
}

/** PF location id for a community/building, from the local cache first. */
async function locationId(client: PfClient, m: PfMapping, mode: string, i: PublishInput) {
  const name = [i.listing.building, i.listing.sub_community, i.listing.community].find(Boolean);
  if (!name || !m.endpoints.locationsSearch) return null;
  const cached = await sb<{ location_id: string }[]>(`pf_locations?mode=eq.${q(mode)}&name=ilike.${q(name)}&select=location_id&limit=1`);
  if (cached[0]) return cached[0].location_id;
  const res = await client.raw("location_search", "GET", fill(m.endpoints.locationsSearch, { query: name }));
  const list = (Array.isArray(res) ? res : (dig(res, "data") as unknown[]) ?? []) as Record<string, unknown>[];
  const rows = list.slice(0, 20).map((r) => ({ mode, location_id: String(r.id ?? ""), name: String(r.name ?? dig(r, "name.en") ?? ""), path: String(r.path ?? ""), type: String(r.type ?? "") })).filter((r) => r.location_id && r.name);
  if (rows.length) await sb("pf_locations?on_conflict=mode,location_id", { method: "POST", prefer: "resolution=merge-duplicates", body: rows }).catch(() => {});
  return rows[0]?.location_id ?? null;
}

function payload(m: PfMapping, i: PublishInput, location: string | null) {
  const l = i.listing as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [pfKey, src] of Object.entries(m.fields)) {
    if (pfKey.startsWith("_")) continue;
    let v: unknown;
    if (src.startsWith("const:")) v = src.slice(6);
    else if (src === "ref") v = i.listing.id;
    else if (src === "location_id") v = location;
    else if (src === "images") v = i.photoUrls;
    else if (src === "agent_id") v = i.agent.portalAgentId ?? null;
    else v = l[src];
    if (v === null || v === undefined || v === "") continue;
    const mapped = m.values[src]?.[String(v)];
    // "a.b.c" keys build nested objects.
    const keys = pfKey.split(".");
    let o = out;
    for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
    o[keys[keys.length - 1]] = mapped ?? v;
  }
  return out;
}

function mapStatus(m: PfMapping, raw: unknown): PortalStatus {
  const s = String(raw ?? "").toLowerCase();
  const mapped = m.statusMap[s] as PortalStatus | undefined;
  if (mapped) return mapped;
  if (/live|publish|active|online/.test(s)) return "live";
  if (/reject|declin|fail/.test(s)) return "rejected";
  if (/unpublish|archiv|offline|deleted/.test(s)) return "unpublished";
  if (/expir/.test(s)) return "expired";
  return "submitted";
}

async function guarded(ctx: AdapterContext, fn: (c: PfClient, m: PfMapping) => Promise<PublishResult>): Promise<PublishResult> {
  const m = pfMapping();
  const missing = pfMissing(m);
  if (missing.length) {
    const message = `Property Finder isn't set up yet. Missing from the official PF docs: ${missing.join("; ")}.`;
    await ctx.log({ action: "config", ok: false, error: message });
    return { status: "rejected", error: { code: "NOT_CONFIGURED", message, plain: "Property Finder publishing isn't switched on yet: the API details from Property Finder's documentation still need to be added. Use the demo portal or Bayut for now." } };
  }
  try {
    return await fn(new PfClient(m, ctx), m);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    // 5xx / network: let the job retry. 4xx: a real rejection to show the agent.
    if (!status || status >= 500) throw err;
    return { status: "rejected", error: translateError(msg, String(status)) };
  }
}

export const propertyFinderAdapter: PortalAdapter = {
  portal: "propertyfinder",
  async validate(i) {
    return i.agent.portalAgentId ? [] : [{ level: "error", message: "Link this agent to their Property Finder user in Portal Settings → Agents.", portal: "propertyfinder" }];
  },
  publish: (i, ctx) => guarded(ctx, async (c, m) => {
    const loc = await locationId(c, m, ctx.connection.mode, i);
    let id = i.externalId;
    if (!id) {
      const created = await c.raw("publish", "POST", m.endpoints.createListing!, payload(m, i, loc));
      id = String(dig(created, m.idPath ?? "id") ?? dig(created, "data.id") ?? "");
      if (!id) throw new Error("Property Finder didn't return a listing id.");
    }
    await c.raw("publish", "POST", fill(m.endpoints.publishListing!, { id }));
    return { status: "submitted", externalId: id, checkAgainInMs: 60_000 };
  }),
  update: (i, ctx) => guarded(ctx, async (c, m) => {
    if (!i.externalId) return propertyFinderAdapter.publish(i, ctx);
    const loc = await locationId(c, m, ctx.connection.mode, i);
    await c.raw("update", "PUT", fill(m.endpoints.updateListing!, { id: i.externalId }), payload(m, i, loc));
    return { status: "submitted", externalId: i.externalId, checkAgainInMs: 60_000 };
  }),
  unpublish: (i, ctx) => guarded(ctx, async (c, m) => {
    if (i.externalId) await c.raw("unpublish", "POST", fill(m.endpoints.unpublishListing!, { id: i.externalId }));
    return { status: "unpublished", externalId: i.externalId };
  }),
  getStatus: (i, ctx) => guarded(ctx, async (c, m) => {
    if (!i.externalId) return { status: "draft" };
    const r = await c.raw("status", "GET", fill(m.endpoints.getListing!, { id: i.externalId }));
    const status = mapStatus(m, dig(r, m.statusPath ?? "status") ?? dig(r, "data.status"));
    const reason = dig(r, "rejectionReason") ?? dig(r, "data.rejectionReason");
    return { status, externalId: i.externalId, ...(status === "rejected" && reason ? { error: translateError(String(reason)) } : {}), ...(status === "submitted" ? { checkAgainInMs: 5 * 60_000 } : {}) };
  }),
  async fetchLeads(ctx) {
    // Stub: leads → Sixty AI WhatsApp / call follow-up comes later. Logged so we can see it's wired.
    await ctx.log({ action: "leads_received", ok: true, response: { leads: 0, note: "fetchLeads is a stub" } });
    return { leads: [] };
  },
};

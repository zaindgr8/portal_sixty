import "server-only";
import { q, sb } from "../supabase";
import { decrypt, encrypt } from "../tenant/crypto";
import {
  LISTING_FIELDS, type AuditEntry, type Listing, type ListingField, type ListingMedia, type OwnerPii, type Portal, type PortalConnectionView,
  type PortalDefaults, type PortalEvent, type PortalListing, type PortalStatus, type PortalError,
} from "./types";

// Data access for PropTech. EVERY function takes the workspace id and puts it in the filter, so a listing,
// file or portal row from another agency can't be read or changed even with a valid id.

const W = (ws: string) => `workspace_id=eq.${q(ws)}`;
const now = () => new Date().toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

type Row = Record<string, unknown>;

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
export function toListing(r: Row): Listing {
  const l = {
    id: r.id, workspaceId: r.workspace_id, createdBy: r.created_by, agentId: r.agent_id ?? null, status: r.status,
    tone: r.tone ?? "professional",
    fieldConfidence: r.field_confidence ?? {}, fieldSource: r.field_source ?? {}, aiQuestions: r.ai_questions ?? [], progress: r.progress ?? {},
    aiCostUsd: Number(r.ai_cost_usd ?? 0), aiTokens: Number(r.ai_tokens ?? 0),
    approvedAt: r.approved_at ?? null, approvedBy: r.approved_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  } as Record<string, unknown>;
  for (const f of LISTING_FIELDS) l[f] = r[f] ?? null;
  for (const f of ["bedrooms", "bathrooms", "size_sqft", "plot_sqft", "parking", "price", "cheques", "service_charge"]) l[f] = num(r[f]);
  l.amenities = (r.amenities as string[] | null) ?? [];
  return l as unknown as Listing;
}

const LIST_COLS = "id,status,title_en,community,property_type,price,price_type,offering_type,agent_id,created_by,created_at,updated_at,ai_cost_usd";

export async function listListings(ws: string, f: { status?: string; agent?: string; portal?: string; limit?: number } = {}) {
  let path = `listings?${W(ws)}&select=${LIST_COLS}&order=updated_at.desc&limit=${f.limit ?? 200}`;
  if (f.status) path += `&status=eq.${q(f.status)}`;
  if (f.agent) path += `&agent_id=eq.${q(f.agent)}`;
  const rows = await sb<Row[]>(path);
  if (!rows.length) return { rows, portals: [] as { listing_id: string; portal: Portal; status: PortalStatus }[], covers: [] as { listing_id: string; path: string }[] };
  const ids = rows.map((r) => r.id as string).join(",");
  const [portals, covers] = await Promise.all([
    sb<{ listing_id: string; portal: Portal; status: PortalStatus }[]>(`portal_listings?${W(ws)}&listing_id=in.(${ids})&select=listing_id,portal,status`),
    sb<{ listing_id: string; path: string }[]>(`listing_media?${W(ws)}&listing_id=in.(${ids})&kind=eq.photo&is_cover=eq.true&removed=eq.false&select=listing_id,path`),
  ]);
  let out = rows;
  if (f.portal) {
    const has = new Set(portals.filter((p) => p.portal === f.portal && p.status !== "draft").map((p) => p.listing_id));
    out = rows.filter((r) => has.has(r.id as string));
  }
  return { rows: out, portals, covers };
}

export async function getListingRow(ws: string, id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  return (await sb<Row[]>(`listings?${W(ws)}&id=eq.${q(id)}&select=*`))[0] ?? null;
}
export async function getListing(ws: string, id: string) {
  const r = await getListingRow(ws, id);
  return r ? toListing(r) : null;
}

export async function createListing(ws: string, createdBy: string, init: Row = {}) {
  const rows = await sb<Row[]>("listings", {
    method: "POST", prefer: "return=representation",
    body: { workspace_id: ws, created_by: createdBy, agent_id: createdBy, status: "draft", ...init },
  });
  const l = toListing(rows[0]);
  await sb("listing_inputs", { method: "POST", body: { workspace_id: ws, listing_id: l.id } });
  return l;
}

export async function updateListing(ws: string, id: string, patch: Row) {
  if (!isUuid(id)) throw new Error("Listing not found.");
  const rows = await sb<Row[]>(`listings?${W(ws)}&id=eq.${q(id)}`, { method: "PATCH", prefer: "return=representation", body: { ...patch, updated_at: now() } });
  if (!rows[0]) throw new Error("Listing not found.");
  return toListing(rows[0]);
}

/** Add to the listing's running AI cost (called after each Gemini call). */
export async function addCost(ws: string, id: string, usd: number, tokens: number) {
  if (!usd && !tokens) return;
  const r = await getListingRow(ws, id);
  if (!r) return;
  await sb(`listings?${W(ws)}&id=eq.${q(id)}`, {
    method: "PATCH", body: { ai_cost_usd: Number(r.ai_cost_usd ?? 0) + usd, ai_tokens: Number(r.ai_tokens ?? 0) + tokens },
  });
}

export async function deleteListing(ws: string, id: string) {
  if (!isUuid(id)) return;
  await sb(`listings?${W(ws)}&id=eq.${q(id)}`, { method: "DELETE" });
}

// ---------- owner personal data (encrypted) ----------
export const readOwner = (r: Row | null): OwnerPii | null => decrypt<OwnerPii>((r?.owner_pii as string) ?? null);
export const sealOwner = (o: OwnerPii) => (Object.values(o).some(Boolean) ? encrypt(o) : null);
export function maskOwner(o: OwnerPii | null): OwnerPii | null {
  if (!o) return null;
  const m = (s?: string, keep = 2) => (s ? `${s.slice(0, keep)}${"•".repeat(Math.max(3, s.length - keep - 2))}${s.length > 6 ? s.slice(-2) : ""}` : undefined);
  return { name: o.name ? o.name.split(/\s+/).map((w) => `${w[0]}.`).join(" ") : undefined, idNumber: m(o.idNumber, 3), phone: m(o.phone, 4), email: m(o.email, 2) };
}

// ---------- media ----------
export function toMedia(r: Row): ListingMedia {
  return {
    id: r.id as string, kind: r.kind as ListingMedia["kind"], docType: (r.doc_type as string) ?? null, fileName: (r.file_name as string) ?? "",
    mimeType: (r.mime_type as string) ?? "", sizeBytes: Number(r.size_bytes ?? 0), width: num(r.width), height: num(r.height),
    roomType: (r.room_type as string) ?? null, order: Number(r.sort_order ?? 0), isCover: Boolean(r.is_cover), removed: Boolean(r.removed),
    flags: (r.flags as ListingMedia["flags"]) ?? {},
  };
}
export async function listMediaRows(ws: string, listingId: string): Promise<Row[]> {
  if (!isUuid(listingId)) return [];
  return sb<Row[]>(`listing_media?${W(ws)}&listing_id=eq.${q(listingId)}&select=*&order=sort_order.asc,created_at.asc`);
}
export async function addMedia(ws: string, listingId: string, m: Row) {
  return (await sb<Row[]>("listing_media", { method: "POST", prefer: "return=representation", body: { ...m, workspace_id: ws, listing_id: listingId } }))[0];
}
export async function updateMedia(ws: string, listingId: string, mediaId: string, patch: Row) {
  if (!isUuid(mediaId)) return;
  await sb(`listing_media?${W(ws)}&listing_id=eq.${q(listingId)}&id=eq.${q(mediaId)}`, { method: "PATCH", body: patch });
}
export async function deleteMedia(ws: string, listingId: string, mediaId: string) {
  if (!isUuid(mediaId)) return null;
  return (await sb<Row[]>(`listing_media?${W(ws)}&listing_id=eq.${q(listingId)}&id=eq.${q(mediaId)}`, { method: "DELETE", prefer: "return=representation" }))[0] ?? null;
}

// ---------- inputs ----------
export async function getInputs(ws: string, listingId: string): Promise<Row> {
  return (await sb<Row[]>(`listing_inputs?${W(ws)}&listing_id=eq.${q(listingId)}&select=*`))[0] ?? {};
}
export async function updateInputs(ws: string, listingId: string, patch: Row) {
  await sb(`listing_inputs?on_conflict=listing_id`, {
    method: "POST", prefer: "resolution=merge-duplicates",
    body: { workspace_id: ws, listing_id: listingId, ...patch, updated_at: now() },
  });
}

// ---------- portal connections ----------
export interface PortalConnection { portal: Portal; enabled: boolean; mode: "sandbox" | "live"; credentials: Record<string, string> | null; feedToken: string | null; defaults: PortalDefaults }
const toConn = (r: Row): PortalConnection => ({
  portal: r.portal as Portal, enabled: Boolean(r.enabled), mode: (r.mode as "sandbox" | "live") ?? "sandbox",
  credentials: decrypt<Record<string, string>>(r.credentials as string), feedToken: (r.feed_token as string) ?? null, defaults: (r.defaults as PortalDefaults) ?? {},
});
export async function listConnections(ws: string): Promise<PortalConnection[]> {
  return (await sb<Row[]>(`portal_connections?${W(ws)}&select=*`)).map(toConn);
}
export async function getConnection(ws: string, portal: Portal) {
  return (await listConnections(ws)).find((c) => c.portal === portal) ?? null;
}
export async function upsertConnection(ws: string, portal: Portal, patch: { enabled?: boolean; mode?: string; credentials?: Record<string, string> | null; feedToken?: string; defaults?: PortalDefaults }) {
  const body: Row = { workspace_id: ws, portal, updated_at: now() };
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.mode !== undefined) body.mode = patch.mode;
  if (patch.credentials !== undefined) body.credentials = patch.credentials ? encrypt(patch.credentials) : null;
  if (patch.feedToken !== undefined) body.feed_token = patch.feedToken;
  if (patch.defaults !== undefined) body.defaults = patch.defaults;
  await sb(`portal_connections?on_conflict=workspace_id,portal`, { method: "POST", prefer: "resolution=merge-duplicates", body });
}
/** Without credentials, for the browser. */
export const connectionView = (c: PortalConnection, extra: Partial<PortalConnectionView> = {}): PortalConnectionView => ({
  portal: c.portal, enabled: c.enabled, mode: c.mode, hasCredentials: Boolean(c.credentials && Object.values(c.credentials).some(Boolean)), defaults: c.defaults, ...extra,
});

// ---------- portal listings ----------
export const toPortalListing = (r: Row): PortalListing => ({
  portal: r.portal as Portal, externalId: (r.external_id as string) ?? null, status: r.status as PortalStatus,
  lastError: (r.last_error as PortalError) ?? null, lastSyncedAt: (r.last_synced_at as string) ?? null,
});
export async function listPortalListings(ws: string, listingId: string) {
  return (await sb<Row[]>(`portal_listings?${W(ws)}&listing_id=eq.${q(listingId)}&select=*`)).map(toPortalListing);
}
export async function setPortalListing(ws: string, listingId: string, portal: Portal, patch: { status?: PortalStatus; externalId?: string | null; lastError?: PortalError | null }) {
  const body: Row = { workspace_id: ws, listing_id: listingId, portal, updated_at: now(), last_synced_at: now() };
  if (patch.status) body.status = patch.status;
  if (patch.externalId !== undefined) body.external_id = patch.externalId;
  if (patch.lastError !== undefined) body.last_error = patch.lastError;
  await sb(`portal_listings?on_conflict=listing_id,portal`, { method: "POST", prefer: "resolution=merge-duplicates", body });
}

// ---------- logs ----------
export async function logPortalEvent(ws: string, e: { listingId?: string | null; portal: string; action: string; ok: boolean; request?: unknown; response?: unknown; error?: string | null; durationMs?: number }) {
  try {
    await sb("portal_events", {
      method: "POST",
      body: {
        workspace_id: ws, listing_id: e.listingId ?? null, portal: e.portal, action: e.action, ok: e.ok,
        request: clip(e.request), response: clip(e.response), error: e.error ?? null, duration_ms: e.durationMs ?? null,
      },
    });
  } catch (err) {
    console.error("[proptech] couldn't log portal event", err instanceof Error ? err.message : err);
  }
}
/** Keep logged payloads small and free of secrets. */
function clip(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(v, (k, val) => (/(token|secret|password|api[_-]?key|authorization)/i.test(k) ? "[redacted]" : val));
  return s.length > 20_000 ? { truncated: s.slice(0, 20_000) } : JSON.parse(s);
}
export async function listPortalEvents(ws: string, listingId: string, limit = 100): Promise<PortalEvent[]> {
  const rows = await sb<Row[]>(`portal_events?${W(ws)}&listing_id=eq.${q(listingId)}&select=*&order=created_at.desc&limit=${limit}`);
  return rows.map((r) => ({
    id: Number(r.id), portal: r.portal as string, action: r.action as string, ok: Boolean(r.ok), error: (r.error as string) ?? null,
    durationMs: num(r.duration_ms), createdAt: r.created_at as string, request: r.request, response: r.response,
  }));
}

export async function audit(ws: string, listingId: string, actor: string, action: string, detail: Row = {}) {
  await sb("listing_audit", { method: "POST", body: { workspace_id: ws, listing_id: listingId, actor, action, detail } });
}
export async function listAudit(ws: string, listingId: string): Promise<AuditEntry[]> {
  const rows = await sb<Row[]>(`listing_audit?${W(ws)}&listing_id=eq.${q(listingId)}&select=*&order=created_at.desc&limit=100`);
  return rows.map((r) => ({ id: Number(r.id), actor: r.actor as string, action: r.action as string, detail: (r.detail as Row) ?? {}, createdAt: r.created_at as string }));
}

export async function listUsage(ws: string, listingId: string) {
  const rows = await sb<Row[]>(`ai_usage?${W(ws)}&listing_id=eq.${q(listingId)}&select=task,model,input_tokens,output_tokens,cost_usd,ok,created_at&order=created_at.asc`);
  return rows.map((r) => ({
    task: r.task as string, model: r.model as string, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens),
    costUsd: Number(r.cost_usd), ok: Boolean(r.ok), createdAt: r.created_at as string,
  }));
}

/** Team members of the agency, for the agent picker. */
export async function listAgents(ws: string) {
  return sb<{ username: string; display_name: string; email: string | null; role: string }[]>(
    `app_users?${W(ws)}&active=eq.true&select=username,display_name,email,role&order=display_name.asc`,
  );
}

export const LISTING_FIELD_SET = new Set<string>(LISTING_FIELDS);
export const isListingField = (k: string): k is ListingField => LISTING_FIELD_SET.has(k);

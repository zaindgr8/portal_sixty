import "server-only";
import { q, sb } from "../supabase";
import { MODULES, type ModuleKey } from "../auth/modules";
import { decrypt, encrypt } from "./crypto";
import { workspaceId } from "./context";
import type { Onboarding, WorkspaceConfig, WorkspaceInfo, WorkspaceSecrets, WorkspaceStatus } from "./types";

// A workspace is one client account: its own chats, leads, team, settings and API keys.
// The primary workspace is the original install; anything it hasn't saved falls back to .env.local.

interface Row {
  id: string;
  name: string;
  status: WorkspaceStatus;
  plan: string;
  modules: string[];
  features?: string[] | null;
  is_primary: boolean;
  contact_name: string;
  contact_email: string;
  config: WorkspaceConfig | null;
  onboarding: Onboarding | null;
  secrets: string | null;
  notes: string;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
}

export interface Workspace extends WorkspaceInfo {
  secrets: WorkspaceSecrets;
  onboarding: Onboarding;
}

const toWorkspace = (r: Row): Workspace => {
  const secrets = decrypt<WorkspaceSecrets>(r.secrets) ?? {};
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    plan: r.plan,
    modules: r.modules.filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m)),
    features: r.features ?? [],
    isPrimary: r.is_primary,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    config: r.config ?? {},
    onboarding: r.onboarding ?? {},
    secretsSet: { twilioAuthToken: Boolean(secrets.twilioAuthToken), retellApiKey: Boolean(secrets.retellApiKey), instagramToken: Boolean(secrets.instagramToken), whatsappCloudToken: Boolean(secrets.whatsappCloudToken), whatsappCloudPin: Boolean(secrets.whatsappCloudPin) },
    notes: r.notes,
    createdAt: new Date(r.created_at).toISOString(),
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : undefined,
    approvedBy: r.approved_by ?? undefined,
    secrets,
  };
};

/** Strip the decrypted keys before anything goes to the browser. */
export const publicInfo = ({ secrets: _s, onboarding: _o, ...info }: Workspace): WorkspaceInfo => (void _s, void _o, info);

// Short cache: workspaces are read on every webhook and request but change rarely.
const g = globalThis as typeof globalThis & { __wsCache?: Map<string, { at: number; ws: Workspace | null }> };
const cache = (g.__wsCache ??= new Map());
const TTL = 30_000;
export const forgetWorkspace = (id?: string) => (id ? cache.delete(id) : cache.clear());

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.ws;
  const rows = await sb<Row[]>(`workspaces?id=eq.${q(id)}&select=*`);
  const ws = rows[0] ? toWorkspace(rows[0]) : null;
  cache.set(id, { at: Date.now(), ws });
  return ws;
}

/** The workspace the current request or job belongs to. */
export async function currentWorkspace(): Promise<Workspace> {
  const id = await workspaceId();
  const ws = await getWorkspace(id);
  if (!ws) throw new Error(`Workspace "${id}" not found.`);
  return ws;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return (await sb<Row[]>("workspaces?select=*&order=created_at.asc")).map(toWorkspace);
}

export async function primaryWorkspace(): Promise<Workspace | null> {
  const rows = await sb<Row[]>("workspaces?is_primary=eq.true&select=*&limit=1");
  return rows[0] ? toWorkspace(rows[0]) : null;
}

/** "Acme Realty" → "acme-realty" (plus a suffix if it's taken). */
export async function freeSlug(name: string): Promise<string> {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "workspace";
  for (let i = 0; i < 50; i++) {
    const id = i ? `${base}-${i + 1}` : base;
    if (!(await sb<{ id: string }[]>(`workspaces?id=eq.${q(id)}&select=id`)).length) return id;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createWorkspace(w: { name: string; status: WorkspaceStatus; modules: ModuleKey[]; contactName?: string; contactEmail?: string; plan?: string; approvedBy?: string }) {
  const id = await freeSlug(w.name);
  const rows = await sb<Row[]>("workspaces", {
    method: "POST",
    prefer: "return=representation",
    body: {
      id,
      name: w.name,
      status: w.status,
      modules: w.modules,
      plan: w.plan ?? "starter",
      contact_name: w.contactName ?? "",
      contact_email: w.contactEmail ?? "",
      ...(w.status === "active" ? { approved_at: new Date().toISOString(), approved_by: w.approvedBy ?? null } : {}),
    },
  });
  return toWorkspace(rows[0]);
}

export type WorkspacePatch = Partial<Pick<WorkspaceInfo, "name" | "status" | "plan" | "modules" | "features" | "notes" | "contactName" | "contactEmail">> & {
  config?: WorkspaceConfig;
  /** Merged into the saved onboarding data. */
  onboarding?: Partial<Onboarding>;
  /** A key set to "" removes it; keys left out stay as they are. */
  secrets?: Partial<WorkspaceSecrets>;
  approvedBy?: string;
};

export async function updateWorkspace(id: string, patch: WorkspacePatch): Promise<Workspace> {
  const current = await getWorkspace(id);
  if (!current) throw new Error("Workspace not found.");
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.plan !== undefined) body.plan = patch.plan;
  if (patch.modules !== undefined) body.modules = patch.modules;
  if (patch.features !== undefined) body.features = patch.features;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.contactName !== undefined) body.contact_name = patch.contactName;
  if (patch.contactEmail !== undefined) body.contact_email = patch.contactEmail;
  if (patch.status !== undefined) {
    body.status = patch.status;
    if (patch.status === "active" && !current.approvedAt) {
      body.approved_at = new Date().toISOString();
      body.approved_by = patch.approvedBy ?? null;
    }
  }
  if (patch.config) body.config = { ...current.config, ...patch.config };
  if (patch.onboarding) body.onboarding = { ...current.onboarding, ...patch.onboarding };
  if (patch.secrets) {
    const next: WorkspaceSecrets = { ...current.secrets };
    for (const [k, v] of Object.entries(patch.secrets) as [keyof WorkspaceSecrets, string | undefined][]) {
      if (v === undefined) continue;
      if (v === "") delete next[k];
      else next[k] = v;
    }
    body.secrets = Object.keys(next).length ? encrypt(next) : null;
  }
  const rows = await sb<Row[]>(`workspaces?id=eq.${q(id)}`, { method: "PATCH", body, prefer: "return=representation" });
  forgetWorkspace(id);
  return toWorkspace(rows[0]);
}

// ---------- credentials, with the primary workspace falling back to .env.local ----------
export interface TwilioCreds { accountSid: string; authToken: string; from: string; messagingServiceSid: string }

const env = (k: string) => (process.env[k] || "").trim();
const whatsappAddr = (a: string) => {
  const v = a.trim().replace(/\s+/g, "");
  return !v ? "" : v.startsWith("whatsapp:") ? v : `whatsapp:${v}`;
};

export function twilioCreds(ws: Workspace): TwilioCreds | null {
  const fb = ws.isPrimary;
  const accountSid = ws.config.twilioAccountSid || (fb ? env("TWILIO_ACCOUNT_SID") : "");
  const authToken = ws.secrets.twilioAuthToken || (fb ? env("TWILIO_AUTH_TOKEN") : "");
  const from = whatsappAddr(ws.config.twilioFrom || (fb ? env("TWILIO_WHATSAPP_FROM") : ""));
  const messagingServiceSid = ws.config.twilioMessagingServiceSid || (fb ? env("TWILIO_MESSAGING_SERVICE_SID") : "");
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) return null;
  return { accountSid, authToken, from, messagingServiceSid };
}

export interface RetellCreds { apiKey: string; agentIds: string[] }

export function retellCreds(ws: Workspace): RetellCreds | null {
  const fb = ws.isPrimary;
  const apiKey = ws.secrets.retellApiKey || (fb ? env("RETELL_API_KEY") : "");
  if (!apiKey) return null;
  const saved = ws.config.retellAgentIds ?? [];
  const agentIds = saved.length ? saved : fb ? env("ALLOWED_AGENT_IDS").split(",").map((s) => s.trim()).filter(Boolean) : [];
  return { apiKey, agentIds };
}

/** Where values come from, for the settings screen ("saved here" vs "from .env.local"). */
export function credentialSources(ws: Workspace) {
  const src = (saved: unknown, envKey: string) => (saved ? "workspace" : ws.isPrimary && env(envKey) ? "env" : null);
  return {
    twilioAccountSid: src(ws.config.twilioAccountSid, "TWILIO_ACCOUNT_SID"),
    twilioAuthToken: src(ws.secrets.twilioAuthToken, "TWILIO_AUTH_TOKEN"),
    twilioFrom: src(ws.config.twilioFrom, "TWILIO_WHATSAPP_FROM"),
    twilioMessagingServiceSid: src(ws.config.twilioMessagingServiceSid, "TWILIO_MESSAGING_SERVICE_SID"),
    retellApiKey: src(ws.secrets.retellApiKey, "RETELL_API_KEY"),
    retellAgentIds: src(ws.config.retellAgentIds?.length, "ALLOWED_AGENT_IDS"),
  };
}

/** Which workspace an incoming Twilio webhook belongs to: ?ws=…, else the number it was sent to, else the account. */
export async function workspaceForTwilio(hint: { ws?: string | null; to?: string; accountSid?: string }): Promise<Workspace | null> {
  if (hint.ws) {
    const ws = await getWorkspace(hint.ws);
    if (ws) return ws;
  }
  const all = await listWorkspaces();
  const to = hint.to ? whatsappAddr(hint.to) : "";
  const live = all.filter((w) => w.status !== "suspended");
  const byNumber = to ? live.find((w) => twilioCreds(w)?.from === to) : undefined;
  if (byNumber) return byNumber;
  const byAccount = hint.accountSid ? live.filter((w) => twilioCreds(w)?.accountSid === hint.accountSid) : [];
  if (byAccount.length === 1) return byAccount[0];
  return byAccount.find((w) => w.isPrimary) ?? null;
}

export function publicBaseUrl() {
  return env("PUBLIC_BASE_URL").replace(/\/$/, "");
}

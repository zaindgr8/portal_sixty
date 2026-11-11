import "server-only";
import type { SessionUser } from "../auth/modules";

// The assistant's tools. Like an MCP server, but inside the portal: every tool calls the portal's OWN API
// routes with the signed-in user's cookie, so it can only see and do what that user could in the UI
// (same workspace, role, modules, validation). Reads run straight away; anything that changes data or
// contacts a customer stops and asks the user to confirm first.

type S =
  | { type: "STRING"; description?: string; enum?: string[] }
  | { type: "INTEGER" | "NUMBER" | "BOOLEAN"; description?: string }
  | { type: "ARRAY"; items: S; description?: string }
  | { type: "OBJECT"; properties: Record<string, S>; required?: string[]; description?: string };

export interface ToolCtx {
  user: SessionUser;
  /** Calls a portal API route as the user. */
  call: (method: string, path: string, body?: unknown) => Promise<{ ok: boolean; status: number; data: unknown }>;
}

export interface Tool {
  name: string;
  description: string;
  params: { type: "OBJECT"; properties: Record<string, S>; required?: string[] };
  /** "write" tools need the user's OK before they run. */
  kind: "read" | "write" | "client";
  /** Hidden unless the user has this module / feature. */
  needs?: "whatsapp" | "calls" | "proptech" | "manager";
  /** One line shown on the confirm card ("Send 'Hi' to +9715…"). */
  summary?: (a: Record<string, unknown>) => string;
  run: (a: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
}

const str = (description?: string, e?: string[]): S => ({ type: "STRING", ...(description ? { description } : {}), ...(e ? { enum: e } : {}) });
const int = (description?: string): S => ({ type: "INTEGER", ...(description ? { description } : {}) });
const bool = (description?: string): S => ({ type: "BOOLEAN", ...(description ? { description } : {}) });
const obj = (properties: Record<string, S>, required?: string[]) => ({ type: "OBJECT" as const, properties, ...(required ? { required } : {}) });
const enc = (v: unknown) => encodeURIComponent(String(v ?? ""));
const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

async function get(ctx: ToolCtx, path: string) {
  const r = await ctx.call("GET", path);
  if (!r.ok) throw new Error(errorOf(r.data, r.status));
  return r.data;
}
async function send(ctx: ToolCtx, method: string, path: string, body?: unknown) {
  const r = await ctx.call(method, path, body);
  if (!r.ok) throw new Error(errorOf(r.data, r.status));
  return r.data;
}
const errorOf = (d: unknown, status: number) => (d && typeof d === "object" && "error" in d ? String((d as { error: unknown }).error) : `Request failed (${status})`);

type Conv = {
  id: string; phone: string; name?: string; profileName?: string; channel?: string; status: string; aiEnabled: boolean; needsHuman: boolean;
  unread: number; assignee?: string; tags: string[]; lastMessageAt?: string; lastInboundAt?: string; lastMessagePreview?: string;
  lead?: { stage?: string; score?: number; priority?: string; intent?: string; summary?: string; nextStep?: string; company?: string; email?: string };
};
const compactConv = (c: Conv) => ({
  id: c.id, name: c.name || c.profileName || c.phone, phone: c.phone, channel: c.channel === "instagram" ? "instagram" : "whatsapp", status: c.status,
  ai: c.aiEnabled, needsHuman: c.needsHuman, unread: c.unread, assignee: c.assignee ?? null, tags: c.tags, lastMessageAt: c.lastMessageAt,
  lastMessage: c.lastMessagePreview?.slice(0, 140), stage: c.lead?.stage, score: c.lead?.score, priority: c.lead?.priority, intent: c.lead?.intent?.slice(0, 120),
  nextStep: c.lead?.nextStep?.slice(0, 160), company: c.lead?.company,
});

/** Read-only paths the generic tool may fetch. Admin, auth, media and live streams are left out on purpose. */
const GET_ALLOW = [
  /^\/api\/me$/, /^\/api\/overview$/, /^\/api\/workspace$/, /^\/api\/workspace\/invites$/, /^\/api\/onboarding$/,
  /^\/api\/whatsapp\/(conversations|leads|stats|team|settings|templates|history|scoring|agent-events)(\/[^/]+(\/notes)?)?$/,
  /^\/api\/voice\/(calls|leads|batches|config)(\/[^/]+)?$/, /^\/api\/proptech\/(listings|agents|portals)(\/[^/]+(\/permit)?)?$/, /^\/api\/instagram$/, /^\/api\/whatsapp-cloud$/,
];
/** Paths the generic write tool may change (always behind a confirmation). */
const WRITE_ALLOW = [
  /^\/api\/whatsapp\/conversations\/[^/]+(\/(notes|messages|analyze))?$/, /^\/api\/whatsapp\/(settings|team(\/[^/]+)?|scoring|sync)$/,
  /^\/api\/voice\/(leads(\/[^/]+(\/(notes|brief))?)?|calls|batches)$/, /^\/api\/proptech\/listings(\/[^/]+(\/(publish|unpublish|duplicate|regenerate|process|media))?)?$/,
  /^\/api\/proptech\/portals$/, /^\/api\/workspace(\/invites)?$/,
];
const pathOnly = (p: string) => p.split("?")[0];

export const TOOLS: Tool[] = [
  // ---------- general ----------
  {
    name: "get_overview", kind: "read", description: "Headline numbers for the workspace: chats, leads, calls, what needs attention today.",
    params: obj({}), run: (_a, ctx) => get(ctx, "/api/overview"),
  },
  {
    name: "open_page", kind: "client",
    description: "Open a page of the portal for the user, e.g. /whatsapp?c=<chat id>, /whatsapp/leads, /calls/history, /proptech/listings/<id>, /proptech/new, /settings.",
    params: obj({ path: str("A portal path starting with /") }, ["path"]),
    run: async (a) => {
      const p = String(a.path ?? "");
      if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/api/")) throw new Error("Only portal pages can be opened.");
      return { navigate: p };
    },
  },
  {
    name: "portal_get", kind: "read",
    description: "Fetch any read-only portal API path when no other tool fits (GET only). Paths: /api/whatsapp/conversations, /api/whatsapp/conversations/<id>/notes, /api/whatsapp/stats, /api/whatsapp/settings, /api/whatsapp/templates, /api/voice/config, /api/voice/leads/<phone>, /api/workspace, /api/proptech/portals, etc.",
    params: obj({ path: str("Path starting with /api/, query string allowed") }, ["path"]),
    run: async (a, ctx) => {
      const p = String(a.path ?? "");
      if (!GET_ALLOW.some((re) => re.test(pathOnly(p)))) throw new Error(`That path isn't available to the assistant: ${pathOnly(p)}`);
      return get(ctx, p);
    },
  },
  {
    name: "portal_write", kind: "write",
    description: "Change something through the portal API when no specific tool fits (POST/PUT/PATCH/DELETE). The user will be asked to confirm. Use the same JSON body the portal's own screens send.",
    params: obj({ method: str("HTTP method", ["POST", "PUT", "PATCH", "DELETE"]), path: str("Path starting with /api/"), body_json: str("JSON body as a string, or empty") }, ["method", "path"]),
    summary: (a) => `${a.method} ${a.path}${a.body_json ? ` ${String(a.body_json).slice(0, 200)}` : ""}`,
    run: async (a, ctx) => {
      const p = String(a.path ?? "");
      if (!WRITE_ALLOW.some((re) => re.test(pathOnly(p)))) throw new Error(`The assistant can't change ${pathOnly(p)}. Do it from the page instead.`);
      let body: unknown;
      if (a.body_json) { try { body = JSON.parse(String(a.body_json)); } catch { throw new Error("body_json isn't valid JSON."); } }
      return send(ctx, String(a.method), p, body);
    },
  },

  // ---------- inbox (WhatsApp + Instagram) ----------
  {
    name: "list_conversations", kind: "read", needs: "whatsapp",
    description: "List inbox chats (WhatsApp and Instagram) with filters. Returns the most recent first.",
    params: obj({
      channel: str("Channel", ["all", "whatsapp", "instagram"]), status: str("Chat status", ["open", "resolved", "any"]),
      unread_only: bool(), needs_human: bool("Only chats the AI handed to a human"), assignee: str("Username, 'me' or 'none'"),
      stage: str("Lead stage", ["new", "qualified", "hot", "won", "lost"]), search: str("Text to look for in name, phone, last message, company, tags"),
      limit: int("Max rows, default 25"),
    }),
    run: async (a, ctx) => {
      const all = (await get(ctx, "/api/whatsapp/conversations")) as Conv[];
      const q = String(a.search ?? "").toLowerCase().trim();
      const who = a.assignee === "me" ? ctx.user.username : a.assignee;
      const rows = all.filter((c) =>
        (!a.channel || a.channel === "all" || (a.channel === "instagram") === (c.channel === "instagram"))
        && (!a.status || a.status === "any" || c.status === a.status)
        && (!a.unread_only || c.unread > 0) && (!a.needs_human || c.needsHuman)
        && (!who || (who === "none" ? !c.assignee : c.assignee === who))
        && (!a.stage || c.lead?.stage === a.stage)
        && (!q || `${c.name ?? ""} ${c.profileName ?? ""} ${c.phone} ${c.lastMessagePreview ?? ""} ${c.lead?.company ?? ""} ${c.lead?.intent ?? ""} ${c.tags.join(" ")}`.toLowerCase().includes(q)));
      const limit = Math.min(Number(a.limit) || 25, 100);
      return { total: rows.length, showing: Math.min(limit, rows.length), chats: rows.slice(0, limit).map(compactConv) };
    },
  },
  {
    name: "get_conversation", kind: "read", needs: "whatsapp",
    description: "One chat: its lead profile and recent messages. Use the id from list_conversations (e.g. 'whatsapp:+9715…' or 'instagram:…').",
    params: obj({ id: str(), messages: int("How many recent messages, default 30") }, ["id"]),
    run: async (a, ctx) => {
      const r = (await get(ctx, `/api/whatsapp/conversations/${enc(a.id)}`)) as { conversation: Conv; messages: { createdAt: string; direction: string; author: string; body: string; status?: string }[] };
      const n = Math.min(Number(a.messages) || 30, 100);
      return { chat: { ...compactConv(r.conversation), lead: r.conversation.lead }, messages: r.messages.slice(-n).map((m) => ({ at: m.createdAt, from: m.direction === "inbound" ? "customer" : m.author, text: m.body?.slice(0, 600), status: m.status })) };
    },
  },
  {
    name: "search_messages", kind: "read", needs: "whatsapp",
    description: "Search every message in the inbox by text and/or date range (YYYY-MM-DD).",
    params: obj({ q: str(), from: str("Start date YYYY-MM-DD"), to: str("End date YYYY-MM-DD"), limit: int() }),
    run: async (a, ctx) => {
      const r = (await get(ctx, `/api/whatsapp/history${qs({ q: a.q, from: a.from, to: a.to, limit: Math.min(Number(a.limit) || 40, 200) })}`)) as { total: number; rows: { createdAt: string; contact: string; conversationId: string; direction: string; body: string }[] };
      return { total: r.total, rows: r.rows.map((m) => ({ at: m.createdAt, contact: m.contact, chat: m.conversationId, direction: m.direction, text: m.body?.slice(0, 300) })) };
    },
  },
  {
    name: "whatsapp_stats", kind: "read", needs: "whatsapp", description: "Inbox analytics: funnel, response times, volumes.",
    params: obj({}), run: (_a, ctx) => get(ctx, "/api/whatsapp/stats"),
  },
  {
    name: "list_whatsapp_leads", kind: "read", needs: "whatsapp", description: "Lead profiles from the WhatsApp agent (name, interest, stage, score).",
    params: obj({ limit: int() }),
    run: async (a, ctx) => {
      const r = (await get(ctx, "/api/whatsapp/leads")) as unknown;
      const rows = Array.isArray(r) ? r : ((r as { leads?: unknown[]; rows?: unknown[] }).leads ?? (r as { rows?: unknown[] }).rows ?? []);
      return { total: rows.length, leads: rows.slice(0, Math.min(Number(a.limit) || 50, 200)) };
    },
  },
  {
    name: "list_team", kind: "read", needs: "whatsapp", description: "Teammates who can be assigned chats, with their load.",
    params: obj({}), run: (_a, ctx) => get(ctx, "/api/whatsapp/team"),
  },
  {
    name: "send_message", kind: "write", needs: "whatsapp",
    description: "Send a message to a customer in a chat as the user. Pauses the AI agent for that chat. WhatsApp only allows free text within 24h of the customer's last message.",
    params: obj({ conversation_id: str(), text: str() }, ["conversation_id", "text"]),
    summary: (a) => `Send to ${String(a.conversation_id).replace(/^(whatsapp|instagram):/, "")}: “${String(a.text).slice(0, 300)}”`,
    run: (a, ctx) => send(ctx, "POST", `/api/whatsapp/conversations/${enc(a.conversation_id)}/messages`, { body: String(a.text) }),
  },
  {
    name: "update_conversation", kind: "write", needs: "whatsapp",
    description: "Change a chat: resolve/reopen, assign (username, or empty to unassign), turn its AI on/off, set tags, set the lead stage, mark needs-human.",
    params: obj({
      id: str(), status: str(undefined, ["open", "resolved"]), assignee: str("Username or empty string to unassign"), ai_enabled: bool(),
      needs_human: bool(), tags: { type: "ARRAY", items: str() }, stage: str(undefined, ["new", "qualified", "hot", "won", "lost"]),
    }, ["id"]),
    summary: (a) => `Update chat ${String(a.id).replace(/^(whatsapp|instagram):/, "")}: ${Object.entries(a).filter(([k]) => k !== "id").map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join(", ") : v === "" ? "nobody" : v}`).join(", ")}`,
    run: (a, ctx) => {
      const body: Record<string, unknown> = {};
      if (a.status) body.status = a.status;
      if (a.assignee !== undefined) body.assignee = a.assignee || null;
      if (a.ai_enabled !== undefined) body.aiEnabled = a.ai_enabled;
      if (a.needs_human !== undefined) body.needsHuman = a.needs_human;
      if (a.tags) body.tags = a.tags;
      if (a.stage) body.lead = { stage: a.stage };
      return send(ctx, "PATCH", `/api/whatsapp/conversations/${enc(a.id)}`, body);
    },
  },
  {
    name: "add_note", kind: "write", needs: "whatsapp", description: "Add an internal team note to a chat (customers never see it).",
    params: obj({ conversation_id: str(), text: str() }, ["conversation_id", "text"]),
    summary: (a) => `Note on ${String(a.conversation_id).replace(/^(whatsapp|instagram):/, "")}: “${String(a.text).slice(0, 300)}”`,
    run: (a, ctx) => send(ctx, "POST", `/api/whatsapp/conversations/${enc(a.conversation_id)}/notes`, { body: String(a.text) }),
  },
  {
    name: "set_ai_agent", kind: "write", needs: "manager", description: "Pause or resume the WhatsApp/Instagram AI agent for the whole workspace.",
    params: obj({ enabled: bool() }, ["enabled"]),
    summary: (a) => (a.enabled ? "Resume the AI agent on every chat" : "Pause the AI agent on every chat"),
    run: (a, ctx) => send(ctx, "PUT", "/api/whatsapp/settings", { agentEnabled: Boolean(a.enabled) }),
  },

  // ---------- voice calls ----------
  {
    name: "list_call_leads", kind: "read", needs: "calls", description: "Voice-call leads: stage, follow-ups, last call outcome, sorted by priority.",
    params: obj({ archived: bool(), limit: int() }),
    run: async (a, ctx) => {
      const r = (await get(ctx, `/api/voice/leads${a.archived ? "?archived=1" : ""}`)) as { leads: unknown[] };
      return { total: r.leads.length, leads: r.leads.slice(0, Math.min(Number(a.limit) || 40, 200)) };
    },
  },
  {
    name: "list_calls", kind: "read", needs: "calls", description: "Recent AI voice calls with outcome, duration and summary.",
    params: obj({ limit: int() }),
    run: async (a, ctx) => {
      const r = (await get(ctx, "/api/voice/calls")) as { calls?: Record<string, unknown>[] } | Record<string, unknown>[];
      const rows = Array.isArray(r) ? r : r.calls ?? [];
      return { total: rows.length, calls: rows.slice(0, Math.min(Number(a.limit) || 25, 100)).map((c) => ({ ...c, transcript: undefined, recording_url: undefined })) };
    },
  },
  {
    name: "get_call", kind: "read", needs: "calls", description: "One call in full, including the transcript.",
    params: obj({ id: str() }, ["id"]), run: (a, ctx) => get(ctx, `/api/voice/calls/${enc(a.id)}`),
  },
  {
    name: "voice_config", kind: "read", needs: "calls", description: "Which voice agents and caller numbers this workspace can use (needed before start_call).",
    params: obj({}), run: (_a, ctx) => get(ctx, "/api/voice/config"),
  },
  {
    name: "update_call_lead", kind: "write", needs: "calls", description: "Edit a voice-call lead: name, email, company, stage, value, tags, follow-up time (unix ms), archived.",
    params: obj({ phone: str("International format, e.g. +9715…"), fields_json: str("JSON object of fields to change") }, ["phone", "fields_json"]),
    summary: (a) => `Update lead ${a.phone}: ${String(a.fields_json).slice(0, 200)}`,
    run: async (a, ctx) => {
      let body: unknown;
      try { body = JSON.parse(String(a.fields_json)); } catch { throw new Error("fields_json isn't valid JSON."); }
      return send(ctx, "PATCH", `/api/voice/leads/${enc(a.phone)}`, body);
    },
  },
  {
    name: "start_call", kind: "write", needs: "calls", description: "Have an AI voice agent call someone now. Check voice_config first for from_number and agent_id.",
    params: obj({ to_number: str(), from_number: str(), agent_id: str() }, ["to_number", "from_number"]),
    summary: (a) => `Call ${a.to_number} now from ${a.from_number}${a.agent_id ? ` with agent ${a.agent_id}` : ""}`,
    run: (a, ctx) => send(ctx, "POST", "/api/voice/calls", { to_number: a.to_number, from_number: a.from_number, agent_id: a.agent_id || undefined }),
  },

  // ---------- PropTech ----------
  {
    name: "list_listings", kind: "read", needs: "proptech", description: "Auto Listing: property listings with status, price and portal status.",
    params: obj({ status: str(undefined, ["draft", "processing", "review", "approved", "published", "archived", "failed"]), portal: str(undefined, ["propertyfinder", "bayut", "mock"]), agent: str("Agent username") }),
    run: (a, ctx) => get(ctx, `/api/proptech/listings${qs({ status: a.status, portal: a.portal, agent: a.agent })}`),
  },
  {
    name: "get_listing", kind: "read", needs: "proptech", description: "One listing: every field, what's missing, validation issues, portal status. Owner details stay masked unless the user is an admin.",
    params: obj({ id: str() }, ["id"]),
    run: async (a, ctx) => {
      const b = (await get(ctx, `/api/proptech/listings/${enc(a.id)}`)) as Record<string, unknown> & { media?: { kind: string; isCover: boolean; removed: boolean; flags: unknown; roomType: string | null }[]; events?: unknown[] };
      return { ...b, media: b.media?.map((m) => ({ kind: m.kind, cover: m.isCover, removed: m.removed, room: m.roomType, flags: m.flags })), events: undefined };
    },
  },
  {
    name: "update_listing", kind: "write", needs: "proptech", description: "Change fields of a listing (e.g. price, bedrooms, view, permit_number, permit_expiry YYYY-MM-DD, title_en, description_en).",
    params: obj({ id: str(), fields_json: str("JSON object of field → value") }, ["id", "fields_json"]),
    summary: (a) => `Update listing ${String(a.id).slice(0, 8)}: ${String(a.fields_json).slice(0, 240)}`,
    run: async (a, ctx) => {
      let fields: unknown;
      try { fields = JSON.parse(String(a.fields_json)); } catch { throw new Error("fields_json isn't valid JSON."); }
      const b = (await send(ctx, "PATCH", `/api/proptech/listings/${enc(a.id)}`, { fields })) as { validation?: unknown };
      return { ok: true, validation: b.validation };
    },
  },
  {
    name: "publish_listing", kind: "write", needs: "proptech", description: "Approve and publish a listing to portals (only works when its validation passes and the permit is valid).",
    params: obj({ id: str(), portals: { type: "ARRAY", items: str(undefined, ["propertyfinder", "bayut", "mock"]) } }, ["id", "portals"]),
    summary: (a) => `Publish listing ${String(a.id).slice(0, 8)} to ${(a.portals as string[]).join(", ")}`,
    run: async (a, ctx) => {
      const r = await ctx.call("POST", `/api/proptech/listings/${enc(a.id)}/publish`, { portals: a.portals, action: "publish" });
      if (!r.ok) return { ok: false, error: errorOf(r.data, r.status), issues: (r.data as { issues?: unknown })?.issues };
      return { ok: true, portals: (r.data as { portals?: unknown }).portals };
    },
  },
  {
    name: "unpublish_listing", kind: "write", needs: "proptech", description: "Take a listing off portals.",
    params: obj({ id: str(), portals: { type: "ARRAY", items: str(undefined, ["propertyfinder", "bayut", "mock"]) } }, ["id"]),
    summary: (a) => `Unpublish listing ${String(a.id).slice(0, 8)}${Array.isArray(a.portals) && a.portals.length ? ` from ${(a.portals as string[]).join(", ")}` : " everywhere"}`,
    run: (a, ctx) => send(ctx, "POST", `/api/proptech/listings/${enc(a.id)}/unpublish`, { portals: a.portals }),
  },
];

/** The tools this user may use (modules, role, PropTech flag). */
export function toolsFor(user: SessionUser, features: string[]) {
  const manager = user.role === "owner" || user.role === "admin" || user.platformAdmin;
  return TOOLS.filter((t) =>
    !t.needs
    || (t.needs === "manager" ? manager && user.modules.includes("whatsapp")
      : t.needs === "proptech" ? features.includes("proptech_auto_listing")
      : user.modules.includes(t.needs)));
}

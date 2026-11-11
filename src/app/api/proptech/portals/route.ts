import { guard, handle, json, fail } from "@/lib/proptech/access";
import { connectionView, getConnection, listConnections, upsertConnection } from "@/lib/proptech/store";
import { feedUrl, forgetFeed, newFeedToken } from "@/lib/proptech/adapters/bayut";
import { pfMissing } from "@/lib/proptech/adapters/propertyfinder";
import { originOf } from "@/lib/tenant/api";
import { q, sb } from "@/lib/supabase";
import { PORTALS, type Portal, type PortalDefaults } from "@/lib/proptech/types";

export const dynamic = "force-dynamic";

// Portal Settings (agency admins only). Credentials go in encrypted and never come back out.
export const GET = handle(async (req: Request) => {
  const c = await guard(req, { admin: true });
  if (c instanceof Response) return c;
  const conns = await listConnections(c.ws.id);
  const cache = (await sb<{ generated_at: string; last_error: string | null; last_fetched_at: string | null }[]>(`bayut_feed_cache?workspace_id=eq.${q(c.ws.id)}&select=generated_at,last_error,last_fetched_at`))[0];
  const views = PORTALS.map((p) => {
    const conn = conns.find((x) => x.portal === p) ?? { portal: p, enabled: false, mode: "sandbox" as const, credentials: null, feedToken: null, defaults: p === "mock" ? { mock: { rejectFirst: true, delayMs: 800 } } : {} };
    return connectionView(conn, p === "bayut" && conn.feedToken ? { feedUrl: feedUrl(c.ws.id, conn.feedToken, originOf(req)), lastFetchedAt: cache?.last_fetched_at ?? null, lastGeneratedAt: cache?.generated_at ?? null, lastFeedError: cache?.last_error ?? null } : {});
  });
  return json({ portals: views, pfMissing: pfMissing() });
});

export const PUT = handle(async (req: Request) => {
  const c = await guard(req, { admin: true });
  if (c instanceof Response) return c;
  const b = (await req.json().catch(() => ({}))) as { portal?: string; enabled?: boolean; mode?: string; apiKey?: string; apiSecret?: string; clearCredentials?: boolean; defaults?: PortalDefaults; rotateFeedToken?: boolean };
  const portal = b.portal as Portal;
  if (!(PORTALS as readonly string[]).includes(portal)) return fail("Unknown portal.");
  const current = await getConnection(c.ws.id, portal);
  const patch: Parameters<typeof upsertConnection>[2] = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (b.mode === "sandbox" || b.mode === "live") patch.mode = b.mode;
  if (b.clearCredentials) patch.credentials = null;
  else if (b.apiKey !== undefined || b.apiSecret !== undefined) {
    patch.credentials = { ...(current?.credentials ?? {}), ...(b.apiKey ? { apiKey: b.apiKey.trim().slice(0, 300) } : {}), ...(b.apiSecret ? { apiSecret: b.apiSecret.trim().slice(0, 500) } : {}) };
  }
  if (b.defaults) {
    const d = b.defaults;
    const agents = Object.fromEntries(Object.entries(d.agents ?? {}).slice(0, 200).map(([u, a]) => [u.slice(0, 60), {
      brn: a.brn?.replace(/\D/g, "").slice(0, 7) || undefined, portalAgentId: a.portalAgentId?.slice(0, 60) || undefined,
      name: a.name?.slice(0, 80) || undefined, email: a.email?.slice(0, 120) || undefined, phone: a.phone?.slice(0, 30) || undefined,
    }]));
    patch.defaults = {
      ...(current?.defaults ?? {}), orn: d.orn?.replace(/\D/g, "").slice(0, 7) || undefined, agents,
      ...(d.mock ? { mock: { rejectFirst: Boolean(d.mock.rejectFirst), delayMs: Math.min(5000, Math.max(0, Number(d.mock.delayMs ?? 800))) } } : {}),
    };
  }
  if (portal === "bayut" && (b.rotateFeedToken || !current?.feedToken)) patch.feedToken = newFeedToken();
  await upsertConnection(c.ws.id, portal, patch);
  if (portal === "bayut") forgetFeed(c.ws.id);
  return json({ ok: true });
});

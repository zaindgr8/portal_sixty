import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getWorkspace, updateWorkspace, type Workspace } from "../tenant/workspaces";
import { proptechOn } from "./access";

// The Sixty Chrome extension signs in with a pairing token the agent copies from Portal Settings.
// Tokens are signed like session cookies (HMAC with SESSION_SECRET), last 90 days and can be revoked
// per user ("Disconnect extension"), which bumps a timestamp saved in the workspace config.
// They only open /api/ext/*: reading the agent's listings to post and reporting what happened.

const TTL_MS = 90 * 24 * 3600 * 1000;
interface Payload { u: string; n: string; w: string; r: string; iat: number; exp: number; j: string }
export interface ExtUser { username: string; name: string; workspace: string; role: string; issuedAt: number }

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return `${s}:sixty-extension`;
};
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function issueExtensionToken(u: { username: string; name: string; workspace: string; role: string }) {
  const now = Date.now();
  const p: Payload = { u: u.username, n: u.name, w: u.workspace, r: u.role, iat: now, exp: now + TTL_MS, j: randomBytes(6).toString("base64url") };
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return { token: `sx1.${body}.${sign(body)}`, expiresAt: new Date(p.exp).toISOString() };
}

/** The user in a token, or null when it's forged, expired or the wrong format. Revocation is checked separately. */
export function readExtensionToken(token: string | null | undefined): ExtUser | null {
  const m = token?.match(/^sx1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(sign(m[1]));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(m[1], "base64url").toString()) as Payload;
    if (!(p.exp > Date.now()) || !p.u || !p.w) return null;
    return { username: p.u, name: p.n, workspace: p.w, role: p.r, issuedAt: p.iat };
  } catch {
    return null;
  }
}

type ExtConfig = { extensionRevokedAt?: Record<string, number> };
export const revokedAt = (ws: Workspace, username: string) => ((ws.config as ExtConfig).extensionRevokedAt ?? {})[username] ?? 0;

/** "Disconnect extension": every token this user made before now stops working. */
export async function revokeExtension(wsId: string, username: string) {
  const ws = await getWorkspace(wsId);
  if (!ws) return;
  const map = { ...((ws.config as ExtConfig).extensionRevokedAt ?? {}), [username]: Date.now() };
  await updateWorkspace(wsId, { config: { ...(ws.config as object), extensionRevokedAt: map } as never });
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export type ExtCtx = { user: ExtUser; ws: Workspace };
/** Guard for /api/ext/*: a valid, unrevoked token for an active workspace with PropTech on. */
export async function extGuard(req: Request): Promise<ExtCtx | Response> {
  const auth = req.headers.get("authorization") ?? "";
  const user = readExtensionToken(auth.replace(/^Bearer\s+/i, "").trim());
  if (!user) return fail("The extension isn't connected. Pair it again from Portal Settings.", 401);
  const ws = await getWorkspace(user.workspace);
  if (!ws || ws.status !== "active") return fail("This workspace isn't active.", 403);
  if (user.issuedAt <= revokedAt(ws, user.username)) return fail("This extension was disconnected. Pair it again from Portal Settings.", 401);
  if (!proptechOn(ws)) return fail("PropTech isn't enabled for this agency.", 403);
  return { user, ws };
}

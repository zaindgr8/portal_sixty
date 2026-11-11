import "server-only";
import { NextResponse } from "next/server";
import { currentUser } from "../auth/current";
import type { SessionUser } from "../auth/modules";
import { getWorkspace, type Workspace } from "../tenant/workspaces";
import { sameOrigin } from "../tenant/api";
import { PROPTECH_FLAG } from "./types";

// PropTech is on for agencies (workspaces) with the "proptech_auto_listing" flag. Everyone in such an agency can
// create and publish listings; Portal Settings and unmasked owner data are for owners/admins (and platform admins).
export const proptechOn = (ws: Pick<Workspace, "features"> | null | undefined) => Boolean(ws?.features?.includes(PROPTECH_FLAG));
export const isAgencyAdmin = (u: SessionUser) => u.role === "owner" || u.role === "admin" || u.platformAdmin;

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (error: string, status = 400, extra?: object) => json({ error, ...extra }, status);

export type Ctx = { user: SessionUser; ws: Workspace; admin: boolean };

/** Route guard: signed in, workspace active, PropTech enabled, same origin for writes, admin when asked. */
export async function guard(req: Request, opts: { admin?: boolean } = {}): Promise<Ctx | Response> {
  const user = await currentUser();
  if (!user) return fail("Please sign in", 401);
  if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) return fail("Bad origin", 403);
  const ws = await getWorkspace(user.workspace);
  if (!ws || (ws.status !== "active" && !user.platformAdmin)) return fail("This workspace isn't active.", 403);
  if (!proptechOn(ws)) return fail("PropTech isn't enabled for this agency.", 403);
  const admin = isAgencyAdmin(user);
  if (opts.admin && !admin) return fail("Only agency owners and admins can do this.", 403);
  return { user, ws, admin };
}

/** Wrap a handler so thrown errors become a JSON 500 instead of an HTML page. */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (err) {
      console.error("[proptech]", err);
      return fail(err instanceof Error ? err.message : "Something went wrong.", 500);
    }
  };
}

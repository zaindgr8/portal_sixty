import { NextResponse } from "next/server";
import { MODULES, type ModuleKey } from "@/lib/auth/modules";
import { body, fail, requirePlatformAdmin, sameOrigin } from "@/lib/tenant/api";
import { listInvites } from "@/lib/tenant/invites";
import { getWorkspace, publicInfo, updateWorkspace, type WorkspacePatch } from "@/lib/tenant/workspaces";
import { PLANS, type WorkspaceStatus } from "@/lib/tenant/types";
import { q, sb } from "@/lib/supabase";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// One workspace: its details, people and open invites.
export async function GET(_req: Request, { params }: Ctx) {
  const g = await requirePlatformAdmin();
  if ("response" in g) return g.response;
  const id = (await params).id;
  const ws = await getWorkspace(id);
  if (!ws) return fail("Workspace not found.", 404);
  const [users, invites] = await Promise.all([
    sb<{ username: string; display_name: string; email: string | null; role: string; modules: string[]; active: boolean; last_login_at: string | null }[]>(
      `app_users?workspace_id=eq.${q(id)}&select=username,display_name,email,role,modules,active,last_login_at&order=created_at.asc`,
    ),
    listInvites(id),
  ]);
  return NextResponse.json({ workspace: publicInfo(ws), users, invites });
}

// Approve, suspend, change plan or modules.
export async function PATCH(req: Request, { params }: Ctx) {
  const g = await requirePlatformAdmin();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const id = (await params).id;
  const ws = await getWorkspace(id);
  if (!ws) return fail("Workspace not found.", 404);
  const b = await body<{ status: WorkspaceStatus; modules: string[]; features: string[]; plan: string; name: string; notes: string }>(req);

  const patch: WorkspacePatch = { approvedBy: g.user.username };
  if (b.status !== undefined) {
    if (!["pending", "active", "suspended"].includes(b.status)) return fail("Unknown status.");
    if (ws.isPrimary && b.status !== "active") return fail("The primary workspace can't be suspended.");
    patch.status = b.status;
  }
  if (b.modules !== undefined) {
    const modules = b.modules.filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m));
    if (!modules.length) return fail("Pick at least one module.");
    patch.modules = modules;
  }
  if (b.features !== undefined) {
    // Known feature flags only.
    patch.features = (Array.isArray(b.features) ? b.features : []).filter((f) => f === "proptech_auto_listing");
  }
  if (b.plan !== undefined) {
    if (!(PLANS as readonly string[]).includes(b.plan)) return fail("Unknown plan.");
    patch.plan = b.plan;
  }
  if (b.name !== undefined) {
    if (String(b.name).trim().length < 2) return fail("Name is too short.");
    patch.name = String(b.name).trim();
  }
  if (b.notes !== undefined) patch.notes = String(b.notes).slice(0, 2000);
  return NextResponse.json({ workspace: publicInfo(await updateWorkspace(id, patch)) });
}

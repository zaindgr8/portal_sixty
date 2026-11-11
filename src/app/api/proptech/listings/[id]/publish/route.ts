import { guard, handle, json, fail } from "@/lib/proptech/access";
import { requestPublish } from "@/lib/proptech/publish";
import { loadBundle } from "@/lib/proptech/server";
import { PORTALS, type Portal } from "@/lib/proptech/types";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

// Human approval + publish (or re-push with action "update"). Blocked until validation passes;
// price-sanity warnings need { confirm: true }.
export const POST = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const b = (await req.json().catch(() => ({}))) as { portals?: string[]; action?: string; confirm?: boolean };
  const portals = (b.portals ?? []).filter((p): p is Portal => (PORTALS as readonly string[]).includes(p));
  const v = await requestPublish(c.ws.id, c.user.username, id, portals, b.action === "update" ? "update" : "publish", b.confirm === true).catch((e: Error) => ({ ok: false, issues: [{ level: "error" as const, message: e.message }] }));
  if (!v.ok) {
    const needsConfirm = "needsConfirm" in v && v.needsConfirm;
    return fail(needsConfirm ? "Please confirm these before publishing." : "Fix these before publishing.", needsConfirm ? 409 : 422, { issues: v.issues, needsConfirm });
  }
  return json(await loadBundle(c, id));
});

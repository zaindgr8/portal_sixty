import { guard, handle, json } from "@/lib/proptech/access";
import { requestUnpublish } from "@/lib/proptech/publish";
import { loadBundle } from "@/lib/proptech/server";
import { PORTALS, type Portal } from "@/lib/proptech/types";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const b = (await req.json().catch(() => ({}))) as { portals?: string[] };
  const portals = (b.portals?.length ? b.portals : [...PORTALS]).filter((p): p is Portal => (PORTALS as readonly string[]).includes(p));
  await requestUnpublish(c.ws.id, c.user.username, id, portals);
  return json(await loadBundle(c, id));
});

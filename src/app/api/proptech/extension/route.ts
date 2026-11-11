import { guard, handle, json } from "@/lib/proptech/access";
import { issueExtensionToken, revokeExtension, revokedAt } from "@/lib/proptech/extension";
import { originOf } from "@/lib/tenant/api";

export const dynamic = "force-dynamic";

// Pair the Sixty Chrome extension: a code the agent pastes into the extension (it acts as this agent).
export const GET = handle(async (req: Request) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  return json({ portalUrl: originOf(req), revokedAt: revokedAt(c.ws, c.user.username) || null });
});

export const POST = handle(async (req: Request) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const t = issueExtensionToken({ username: c.user.username, name: c.user.name, workspace: c.ws.id, role: c.user.role });
  return json({ ...t, portalUrl: originOf(req) });
});

// Disconnect every extension this agent paired before now.
export const DELETE = handle(async (req: Request) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  await revokeExtension(c.ws.id, c.user.username);
  return json({ ok: true });
});

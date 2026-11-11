import { guard, handle, json } from "@/lib/proptech/access";
import { listAgents, listConnections } from "@/lib/proptech/store";

export const dynamic = "force-dynamic";

// The agency's team, with the BRN saved for each in Portal Settings.
export const GET = handle(async (req: Request) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const [agents, conns] = await Promise.all([listAgents(c.ws.id), listConnections(c.ws.id)]);
  const brn = (u: string) => conns.map((x) => x.defaults.agents?.[u]?.brn).find(Boolean) ?? null;
  return json({ agents: agents.map((a) => ({ username: a.username, name: a.display_name || a.username, role: a.role, brn: brn(a.username) })), me: c.user.username, admin: c.admin });
});

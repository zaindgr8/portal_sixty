import { extGuard } from "@/lib/proptech/extension";
import { extJson } from "@/lib/proptech/ext-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await extGuard(req);
  if (c instanceof Response) return c;
  return extJson({ user: { username: c.user.username, name: c.user.name, role: c.user.role }, workspace: { id: c.ws.id, name: c.ws.name } });
}

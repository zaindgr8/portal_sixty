import { extGuard } from "@/lib/proptech/extension";
import { extJson, extensionConfig } from "@/lib/proptech/ext-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await extGuard(req);
  if (c instanceof Response) return c;
  return extJson(extensionConfig());
}

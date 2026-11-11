import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { guard, handle } from "@/lib/proptech/access";
import { zipStore } from "@/lib/proptech/zip";

export const dynamic = "force-dynamic";

// The Sixty Chrome extension as a zip: unzip, then Chrome → Extensions → Developer mode → Load unpacked.
// (The same zip is what gets uploaded to the Chrome Web Store.)
export const GET = handle(async (req: Request) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const root = path.join(process.cwd(), "extension");
  // On the live portal the zip should only talk to the live portal, not a developer's localhost.
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(new URL(req.url).host);
  const manifestFor = (raw: Buffer) => {
    if (local) return new Uint8Array(raw);
    const m = JSON.parse(raw.toString("utf8")) as { host_permissions?: string[] };
    m.host_permissions = (m.host_permissions ?? []).filter((h) => !/localhost|127\.0\.0\.1/.test(h));
    return new TextEncoder().encode(JSON.stringify(m, null, 2) + "\n");
  };
  const files: { name: string; data: Uint8Array }[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      if (n.startsWith(".")) continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const rel = path.relative(root, p).split(path.sep).join("/");
        files.push({ name: `sixty-extension/${rel}`, data: rel === "manifest.json" ? manifestFor(readFileSync(p)) : new Uint8Array(readFileSync(p)) });
      }
    }
  };
  walk(root);
  return new Response(zipStore(files) as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="sixty-chrome-extension.zip"', "Cache-Control": "no-store" } });
});

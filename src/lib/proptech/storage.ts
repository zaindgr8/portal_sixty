import "server-only";

// Supabase Storage (same project and secret key as the database). One private bucket, "proptech".
// Every object key starts with the workspace id, and every helper checks it, so one agency can never
// read, sign or delete another agency's files even if an id leaks.
const BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const BUCKET = process.env.PROPTECH_BUCKET || "proptech";
/** Signed URLs last 10 minutes by default. */
export const SIGNED_TTL = 600;

const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export class StorageError extends Error {}

/** Throws unless `path` belongs to `workspaceId`. */
export function assertOwned(workspaceId: string, path: string) {
  if (!workspaceId || !path.startsWith(`${workspaceId}/`) || path.includes("..")) throw new StorageError("File not found.");
}

export const objectPath = (workspaceId: string, listingId: string, ext: string) =>
  `${workspaceId}/${listingId}/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin"}`;

export async function putObject(workspaceId: string, path: string, data: Buffer | Uint8Array, contentType: string) {
  assertOwned(workspaceId, path);
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${enc(path)}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "private, max-age=31536000" },
    body: new Uint8Array(data),
  });
  if (!res.ok) throw new StorageError(`Upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/**
 * A one-time link the browser can PUT one file to, straight into storage. Vercel refuses request bodies
 * over 4.5 MB, so photos and scans never pass through the portal's own server.
 */
export async function signUpload(workspaceId: string, path: string): Promise<string> {
  assertOwned(workspaceId, path);
  const res = await fetch(`${BASE}/storage/v1/object/upload/sign/${BUCKET}/${enc(path)}`, { method: "POST", headers: auth });
  if (!res.ok) throw new StorageError(`Couldn't prepare the upload (${res.status}).`);
  const { url } = (await res.json()) as { url: string };
  return `${BASE}/storage/v1${url}`;
}

export async function getObject(workspaceId: string, path: string): Promise<Buffer> {
  assertOwned(workspaceId, path);
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${enc(path)}`, { headers: auth, cache: "no-store" });
  if (!res.ok) throw new StorageError(`Couldn't read the file (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

export async function removeObjects(workspaceId: string, paths: string[]) {
  if (!paths.length) return;
  paths.forEach((p) => assertOwned(workspaceId, p));
  await fetch(`${BASE}/storage/v1/object/${BUCKET}`, {
    method: "DELETE", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }),
  });
}

/** Signed, expiring URLs for many objects at once (path → url). */
export async function signUrls(workspaceId: string, paths: string[], ttl = SIGNED_TTL): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const mine = paths.filter((p) => { try { assertOwned(workspaceId, p); return true; } catch { return false; } });
  if (!mine.length) return out;
  const res = await fetch(`${BASE}/storage/v1/object/sign/${BUCKET}`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: ttl, paths: mine }),
  });
  if (!res.ok) return out;
  const rows = (await res.json()) as { path: string; signedURL?: string; error?: string | null }[];
  for (const r of rows) if (r.signedURL) out.set(r.path, `${BASE}/storage/v1${r.signedURL}`);
  return out;
}

export async function signUrl(workspaceId: string, path: string, ttl = SIGNED_TTL) {
  return (await signUrls(workspaceId, [path], ttl)).get(path) ?? null;
}

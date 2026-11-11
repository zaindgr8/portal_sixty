// Agency B must not reach agency A's listings, files or feed. These tests run the real data-access code
// against a small in-memory stand-in for Supabase's REST API (PostgREST + Storage), so every query the app
// makes is filtered exactly as it would be in production.
import { beforeAll, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const tables = new Map<string, Row[]>();
const objects = new Map<string, Uint8Array>();
const T = (t: string) => (tables.get(t) ?? tables.set(t, []).get(t))!;

function matches(row: Row, params: URLSearchParams) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    const cell = row[k];
    if (op === 'eq' && String(cell) !== (val === 'true' || val === 'false' ? val : decodeURIComponent(val))) return false;
    if (op === 'in') {
      const list = val.replace(/^\(|\)$/g, '').split(',').map((s) => decodeURIComponent(s).replace(/^"|"$/g, ''));
      if (!list.includes(String(cell))) return false;
    }
    if (op === 'ilike' && String(cell).toLowerCase() !== decodeURIComponent(val).toLowerCase()) return false;
  }
  return true;
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const method = (init.method ?? 'GET').toUpperCase();
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.startsWith('/storage/v1/object/sign/')) {
    const body = JSON.parse(String(init.body)) as { paths: string[] };
    return json(body.paths.map((p) => ({ path: p, signedURL: `/object/sign/proptech/${p}?token=x` })));
  }
  if (url.pathname.startsWith('/storage/v1/object/proptech/')) {
    const key = decodeURIComponent(url.pathname.slice('/storage/v1/object/proptech/'.length));
    if (method === 'POST') { objects.set(key, new Uint8Array(init.body as Uint8Array)); return json({ Key: key }); }
    const o = objects.get(key);
    return o ? new Response(new Uint8Array(o)) : json({ error: 'not found' }, 404);
  }
  const m = url.pathname.match(/^\/rest\/v1\/(.+)$/);
  if (!m) return json({ error: 'unknown' }, 404);
  const table = m[1];
  const rows = T(table);
  const params = url.searchParams;
  if (method === 'GET') return json(rows.filter((r) => matches(r, params)));
  if (method === 'POST') {
    const body = JSON.parse(String(init.body));
    const list: Row[] = (Array.isArray(body) ? body : [body]).map((r: Row) => ({ id: r.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
    const conflict = params.get('on_conflict')?.split(',');
    for (const r of list) {
      const existing = conflict ? rows.find((x) => conflict.every((c) => x[c] === r[c])) : undefined;
      if (existing) Object.assign(existing, r); else rows.push(r);
    }
    return json(list, 201);
  }
  const hit = rows.filter((r) => matches(r, params));
  if (method === 'PATCH') { const body = JSON.parse(String(init.body)); hit.forEach((r) => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { tables.set(table, rows.filter((r) => !hit.includes(r))); return json(hit); }
  return json({ error: 'unsupported' }, 400);
}

let store: typeof import('@/lib/proptech/store');
let storage: typeof import('@/lib/proptech/storage');
let bayut: typeof import('@/lib/proptech/adapters/bayut');
let idA = '';
let pathA = '';
let mediaA = '';
const TOKEN_A = 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_B = 'tokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

beforeAll(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://fake.supabase.co');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'test-key');
  vi.stubEnv('CREDENTIALS_KEY', 'test-credentials-key');
  vi.stubGlobal('fetch', fakeFetch);
  store = await import('@/lib/proptech/store');
  storage = await import('@/lib/proptech/storage');
  bayut = await import('@/lib/proptech/adapters/bayut');

  const a = await store.createListing('agency-a', 'ali', { community: 'Dubai Marina', owner_pii: store.sealOwner({ name: 'Owner A', phone: '+971500000001' }) });
  idA = a.id;
  pathA = storage.objectPath('agency-a', idA, 'jpg');
  await storage.putObject('agency-a', pathA, new Uint8Array([1, 2, 3]), 'image/jpeg');
  mediaA = String((await store.addMedia('agency-a', idA, { path: pathA, kind: 'photo', mime_type: 'image/jpeg', sort_order: 0, removed: false })).id);
  await store.setPortalListing('agency-a', idA, 'bayut', { status: 'live' });
  await store.upsertConnection('agency-a', 'bayut', { enabled: true, feedToken: TOKEN_A });
  await store.upsertConnection('agency-b', 'bayut', { enabled: true, feedToken: TOKEN_B });
});

describe('agency isolation', () => {
  it('agency B cannot read, list, edit or delete agency A listings', async () => {
    expect(await store.getListing('agency-a', idA)).not.toBeNull();
    expect(await store.getListing('agency-b', idA)).toBeNull();
    expect((await store.listListings('agency-b')).rows).toHaveLength(0);
    await expect(store.updateListing('agency-b', idA, { price: 1 })).rejects.toThrow();
    await store.deleteListing('agency-b', idA);
    expect(await store.getListing('agency-a', idA)).not.toBeNull();
    expect((await store.getListing('agency-a', idA))?.price).toBeNull();
  });

  it('agency B cannot see A\'s media, inputs or portal rows', async () => {
    expect(await store.listMediaRows('agency-b', idA)).toEqual([]);
    expect(await store.deleteMedia('agency-b', idA, mediaA)).toBeNull();
    expect(await store.listMediaRows('agency-a', idA)).toHaveLength(1);
    expect(await store.listPortalListings('agency-b', idA)).toEqual([]);
    expect(await store.getInputs('agency-b', idA)).toEqual({});
  });

  it('agency B cannot read, sign or delete A\'s files', async () => {
    await expect(storage.getObject('agency-b', pathA)).rejects.toThrow();
    expect((await storage.signUrls('agency-b', [pathA])).size).toBe(0);
    await expect(storage.removeObjects('agency-b', [pathA])).rejects.toThrow();
    expect(() => storage.assertOwned('agency-b', 'agency-b/../agency-a/x.jpg')).toThrow();
    expect((await storage.getObject('agency-a', pathA)).length).toBe(3);
    expect((await storage.signUrls('agency-a', [pathA])).size).toBe(1);
  });

  it('agency B\'s feed token doesn\'t open A\'s feed or photos', async () => {
    expect(await bayut.feedOwner('agency-a', TOKEN_A)).not.toBeNull();
    expect(await bayut.feedOwner('agency-a', TOKEN_B)).toBeNull();
    expect(await bayut.feedOwner('agency-b', TOKEN_A)).toBeNull();
    expect(await bayut.feedMedia('agency-b', mediaA)).toBeNull();
    expect(await bayut.feedMedia('agency-a', mediaA)).not.toBeNull();
  });

  it('owner data is encrypted at rest and masked for non-admins', async () => {
    const row = T('listings').find((r) => r.id === idA)!;
    expect(String(row.owner_pii)).not.toContain('Owner A');
    const owner = store.readOwner(row);
    expect(owner?.name).toBe('Owner A');
    expect(store.maskOwner(owner)?.phone).not.toContain('500000001');
  });
});

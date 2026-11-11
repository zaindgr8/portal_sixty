import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let ext: typeof import('@/lib/proptech/extension');

beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'test-secret');
  ext = await import('@/lib/proptech/extension');
});

describe('extension pairing tokens', () => {
  it('round-trips and rejects tampering', () => {
    const { token } = ext.issueExtensionToken({ username: 'ali', name: 'Ali', workspace: 'agency-a', role: 'member' });
    expect(ext.readExtensionToken(token)).toMatchObject({ username: 'ali', workspace: 'agency-a' });
    const [p, body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), w: 'agency-b' })).toString('base64url');
    expect(ext.readExtensionToken(`${p}.${forged}.${sig}`)).toBeNull();
    expect(ext.readExtensionToken('garbage')).toBeNull();
    expect(ext.readExtensionToken(null)).toBeNull();
  });
  it('is not a session cookie (a different key signs it)', async () => {
    const { createSession, readSession } = await import('@/lib/auth/session');
    const s = createSession({ username: 'ali', name: 'Ali', role: 'member', modules: ['whatsapp'], workspace: 'agency-a', workspaceName: 'A', platformAdmin: false });
    expect(ext.readExtensionToken(`sx1.${s}`)).toBeNull();
    const { token } = ext.issueExtensionToken({ username: 'ali', name: 'Ali', workspace: 'agency-a', role: 'member' });
    expect(readSession(token.slice(4))).toBeNull();
  });
  it('revocation is per user', () => {
    const ws = { config: { extensionRevokedAt: { ali: 123 } } } as never;
    expect(ext.revokedAt(ws, 'ali')).toBe(123);
    expect(ext.revokedAt(ws, 'sara')).toBe(0);
  });
});

describe('extension fill rules', () => {
  const core = require('../../extension/fill-core.js');
  const cfg = require('../../mappings/extension.json');
  it('maps our values to the portal wording', () => {
    const rule = cfg.portals.bayut.fields.purpose;
    expect(core.candidatesFor('purpose', 'sale', rule)[0]).toBe('Buy');
    expect(core.candidatesFor('bedrooms', 0, cfg.portals.propertyfinder.fields.bedrooms)[0]).toBe('Studio');
    expect(core.candidatesFor('amenities', ['Pool', 'Gym'], {})).toEqual(['Pool, Gym']);
    expect(core.candidatesFor('view', null, {})).toEqual([]);
    expect(core.norm(' Price (AED)*: ')).toBe('price aed');
  });
  it('every field rule has labels or selectors', () => {
    for (const p of Object.values(cfg.portals) as { fields: Record<string, { labels?: string[]; selectors?: string[] }> }[]) {
      for (const r of Object.values(p.fields)) expect((r.labels?.length ?? 0) + (r.selectors?.length ?? 0)).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import { TOOLS, toolsFor, type ToolCtx } from '@/lib/assistant/tools';
import type { SessionUser } from '@/lib/auth/modules';

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  username: 'sara', name: 'Sara', role: 'member', modules: ['whatsapp'], workspace: 'agency-a', workspaceName: 'Agency A', platformAdmin: false, ...over,
});
const tool = (n: string) => TOOLS.find((t) => t.name === n)!;
const ctx = (data: unknown = {}): ToolCtx & { call: ReturnType<typeof vi.fn> } => ({ user: user(), call: vi.fn(async () => ({ ok: true, status: 200, data })) });

describe('assistant tools follow the user\'s access', () => {
  it('only offers tools for the user\'s modules, role and features', () => {
    const names = toolsFor(user(), []).map((t) => t.name);
    expect(names).toContain('list_conversations');
    expect(names).not.toContain('list_calls');
    expect(names).not.toContain('set_ai_agent'); // members can't pause the agent for everyone
    expect(names).not.toContain('list_listings'); // PropTech flag off
    const admin = toolsFor(user({ role: 'admin', modules: ['whatsapp', 'calls'] }), ['proptech_auto_listing']).map((t) => t.name);
    expect(admin).toEqual(expect.arrayContaining(['set_ai_agent', 'list_calls', 'start_call', 'list_listings', 'publish_listing']));
  });

  it('marks everything that changes data or contacts a customer as needing confirmation', () => {
    for (const n of ['send_message', 'update_conversation', 'add_note', 'set_ai_agent', 'start_call', 'update_call_lead', 'update_listing', 'publish_listing', 'unpublish_listing', 'portal_write']) {
      expect(tool(n).kind).toBe('write');
      expect(typeof tool(n).summary).toBe('function');
    }
    for (const n of ['list_conversations', 'get_conversation', 'portal_get', 'get_listing']) expect(tool(n).kind).toBe('read');
  });

  it('generic reads are limited to an allowlist (no admin, auth, media or streams)', async () => {
    const c = ctx();
    for (const p of ['/api/admin/workspaces', '/api/auth', '/api/whatsapp/media?url=x', '/api/whatsapp/events', '/api/admin/switch']) {
      await expect(tool('portal_get').run({ path: p }, c)).rejects.toThrow(/isn't available/);
    }
    await tool('portal_get').run({ path: '/api/whatsapp/stats' }, c);
    await tool('portal_get').run({ path: '/api/proptech/listings/abc' }, c);
    expect(c.call).toHaveBeenCalledTimes(2);
  });

  it('generic writes are limited too', async () => {
    const c = ctx();
    for (const p of ['/api/admin/workspaces/x', '/api/auth', '/api/signup', '/api/admin/switch', '/api/instagram']) {
      await expect(tool('portal_write').run({ method: 'POST', path: p }, c)).rejects.toThrow(/can't change/);
    }
    await expect(tool('portal_write').run({ method: 'PATCH', path: '/api/whatsapp/conversations/whatsapp%3A%2B9715', body_json: '{bad' }, c)).rejects.toThrow(/JSON/);
    expect(c.call).not.toHaveBeenCalled();
  });

  it('open_page only opens portal pages', async () => {
    await expect(tool('open_page').run({ path: 'https://evil.example' }, ctx())).rejects.toThrow();
    await expect(tool('open_page').run({ path: '//evil.example' }, ctx())).rejects.toThrow();
    await expect(tool('open_page').run({ path: '/api/me' }, ctx())).rejects.toThrow();
    expect(await tool('open_page').run({ path: '/whatsapp/leads' }, ctx())).toEqual({ navigate: '/whatsapp/leads' });
  });

  it('filters chats by channel and maps updates to the portal API', async () => {
    const chats = [
      { id: 'whatsapp:+1', phone: '+1', channel: 'whatsapp', status: 'open', aiEnabled: true, needsHuman: false, unread: 1, tags: [] },
      { id: 'instagram:2', phone: '', channel: 'instagram', status: 'open', aiEnabled: true, needsHuman: true, unread: 0, tags: [] },
    ];
    const r = (await tool('list_conversations').run({ channel: 'instagram' }, ctx(chats))) as { total: number; chats: { id: string }[] };
    expect(r.chats.map((c) => c.id)).toEqual(['instagram:2']);
    const c = ctx();
    await tool('update_conversation').run({ id: 'whatsapp:+1', status: 'resolved', assignee: '', stage: 'hot' }, c);
    expect(c.call).toHaveBeenCalledWith('PATCH', '/api/whatsapp/conversations/whatsapp%3A%2B1', { status: 'resolved', assignee: null, lead: { stage: 'hot' } });
  });
});

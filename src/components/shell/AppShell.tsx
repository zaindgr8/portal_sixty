'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronsLeft, Sparkles, ChevronsRight, LogOut, Menu, Moon, Search, Sun, X } from 'lucide-react';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import AssistantPanel, { openAssistant } from '@/components/assistant/AssistantPanel';
import { SixtyLogo, SixtyMark } from './SixtyLogo';
import type { SessionUser } from '@/lib/auth/modules';
import { api, displayName, useAgentName, useLive } from '@/lib/whatsapp/client';
import type { Conversation } from '@/lib/whatsapp/types';
import { Avatar, ScoreRing } from '@/components/whatsapp/ui';
import { isActive, navFor, type NavItem } from './nav';
import { useTheme } from './theme';

/** Open a WhatsApp chat from anywhere: the Inbox listens for this, other pages navigate to it. */
export function openChat(router: ReturnType<typeof useRouter>, path: string, id: string) {
  if (path === '/whatsapp') window.dispatchEvent(new CustomEvent('open-chat', { detail: id }));
  else router.push(`/whatsapp?c=${encodeURIComponent(id)}`);
}

function readPref(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export default function AppShell({ user, features = [], children }: { user: SessionUser; features?: string[]; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();
  const agentName = useAgentName();
  // The AI agent page is named after the agent ("Freya").
  const sections = useMemo(
    () => navFor(user, features).map((s) => ({ ...s, items: s.items.map((i) => (i.href === '/whatsapp/agent' ? { ...i, label: agentName } : i)) })),
    [user, agentName, features],
  );
  const hasWa = user.modules.includes('whatsapp');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [agentOn, setAgentOn] = useState<boolean | null>(null);
  const [closedSections, setClosedSections] = useState<string[]>([]);
  const toggleSection = (t: string) => setClosedSections((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a saved preference after hydration
    setCollapsed(readPref('sidebar') === 'collapsed');
  }, []);
  const toggleCollapsed = () => setCollapsed((c) => {
    try { localStorage.setItem('sidebar', c ? 'open' : 'collapsed'); } catch { /* storage unavailable */ }
    return !c;
  });
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile menu after navigating
  useEffect(() => setMobileOpen(false), [path]);

  const loadAgent = useCallback(() => {
    if (!hasWa) return;
    api<{ settings: { agentEnabled: boolean } }>('/api/whatsapp/settings').then((r) => setAgentOn(r.settings.agentEnabled)).catch(() => {});
  }, [hasWa]);
  useEffect(loadAgent, [loadAgent, path]);

  const toggleAgent = useCallback(async () => {
    const next = !agentOn;
    setAgentOn(next);
    await api('/api/whatsapp/settings', { method: 'PUT', json: { agentEnabled: next } }).catch(() => setAgentOn(!next));
  }, [agentOn]);

  const logout = useCallback(async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    window.location.href = '/login';
  }, []);

  // ⌘K opens the palette; ⌥1–6 jumps between the pages of the module you're in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-6]$/.test(e.code)) {
        const section = sections.find((s) => s.module && s.items.some((i) => isActive(i.href, path)));
        const item = section?.items[Number(e.code.slice(5)) - 1];
        if (item) { e.preventDefault(); router.push(item.href); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, sections, path]);

  const sidebar = (rail: boolean) => (
    <div className="flex h-full flex-col">
      <div className={`flex items-center gap-2.5 px-4 pb-5 pt-5 ${rail ? 'justify-center px-0' : ''}`}>
        <Link href="/" className="flex min-w-0 items-center gap-2.5 text-white" title="Sixty by DevMate">
          {rail ? <SixtyMark size={32} className="text-[#E5484D]" /> : <SixtyLogo size={32} />}
        </Link>
      </div>

      <WorkspaceSwitcher user={user} rail={rail} />

      <button onClick={() => setPalette(true)} title="Search & commands  ⌘K"
        className={`mx-3 mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-[13px] text-side-ink transition hover:border-white/20 hover:text-white ${rail ? 'justify-center px-0' : ''}`}>
        <Search size={15} />
        {!rail && <><span>Search…</span><span className="ml-auto rounded border border-white/15 px-1.5 text-[10px]">⌘K</span></>}
      </button>
      <button onClick={openAssistant} title="Ask Sixty: chat to find anything or make changes  ⌘J"
        className={`mx-3 -mt-2 mb-4 flex items-center gap-2 rounded-xl bg-ai/15 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-ai/25 ${rail ? 'justify-center px-0' : ''}`}>
        <Sparkles size={15} className="text-ai" />
        {!rail && <><span>Ask Sixty</span><span className="ml-auto rounded border border-white/15 px-1.5 text-[10px] text-side-ink">⌘J</span></>}
      </button>

      <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((s, i) => (
          <div key={s.title ?? i} className={s.title ? 'mt-5' : ''}>
            {s.title && (
              rail ? <div className="mx-auto mb-2 h-px w-6 bg-white/10" /> : (
                <div className="mb-1.5 flex items-center gap-2 px-2.5">
                  {s.collapsible ? (
                    <button onClick={() => toggleSection(s.title!)} aria-expanded={!closedSections.includes(s.title!)}
                      className="flex flex-1 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em] text-side-ink/80 hover:text-white">
                      {s.title}<ChevronDown size={12} className={`ml-auto transition ${closedSections.includes(s.title!) ? '-rotate-90' : ''}`} />
                    </button>
                  ) : <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-side-ink/80">{s.title}</span>}
                  {s.module === 'whatsapp' && agentOn !== null && (
                    <button onClick={toggleAgent} title={agentOn ? `${agentName} is live on WhatsApp. Click to pause everywhere.` : `${agentName} is paused. Click to resume.`}
                      className={`ml-auto flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${agentOn ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${agentOn ? 'pulse-dot bg-ok text-ok' : 'bg-warn'}`} />
                      {agentOn ? `${agentName} live` : 'Paused'}
                    </button>
                  )}
                </div>
              )
            )}
            {!(s.collapsible && !rail && closedSections.includes(s.title!)) && (
              <ul className="space-y-0.5">
                {s.items.map((it) => <NavLink key={it.href} item={it} active={isActive(it.href, path)} rail={rail} />)}
              </ul>
            )}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className={`flex items-center gap-2.5 ${rail ? 'flex-col' : ''}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-white" title={user.name}>
            {user.name.slice(0, 2).toUpperCase()}
          </span>
          {!rail && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-medium text-white">{user.name}</span>
              <span className="block truncate text-[11px] text-side-ink">{user.username} · <span className="capitalize">{user.role}</span></span>
            </span>
          )}
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} className="rounded-lg p-1.5 text-side-ink hover:bg-white/10 hover:text-white">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button onClick={logout} title="Sign out" className="rounded-lg p-1.5 text-side-ink hover:bg-white/10 hover:text-white"><LogOut size={16} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh">
      {/* Desktop sidebar */}
      <aside className={`relative hidden shrink-0 bg-side transition-[width] duration-200 md:block ${collapsed ? 'w-[72px]' : 'w-[248px]'}`}>
        {sidebar(collapsed)}
        <button onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-7 z-10 grid h-6 w-6 place-items-center rounded-full border border-line bg-panel text-ink-3 shadow hover:text-ink">
          {collapsed ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="anim-rise absolute inset-y-0 left-0 w-[264px] bg-side shadow-2xl">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-5 z-10 rounded-lg p-1 text-side-ink hover:text-white" aria-label="Close menu"><X size={18} /></button>
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-panel px-3 py-2 md:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 text-ink-2 hover:bg-panel-2" aria-label="Open menu"><Menu size={20} /></button>
          <SixtyLogo size={26} by={false} />
          <button onClick={openAssistant} className="ml-auto rounded-lg p-1.5 text-ai hover:bg-panel-2" aria-label="Ask Sixty"><Sparkles size={18} /></button>
          <button onClick={() => setPalette(true)} className="rounded-lg p-1.5 text-ink-2 hover:bg-panel-2" aria-label="Search"><Search size={18} /></button>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
      <AssistantPanel />

      {hasWa && path.startsWith('/whatsapp') && <AgentSettingsListener onChange={loadAgent} />}

      {palette && (
        <CommandPalette onClose={() => setPalette(false)} path={path} router={router} sections={sections} hasWa={hasWa}
          actions={[
            ...(hasWa && agentOn !== null ? [{ id: 'agent', label: agentOn ? `Pause ${agentName} everywhere` : `Resume ${agentName}`, icon: Bot, run: toggleAgent }] : []),
            { id: 'theme', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: theme === 'dark' ? Sun : Moon, run: toggleTheme },
            { id: 'logout', label: 'Sign out', icon: LogOut, run: logout },
          ]} />
      )}
    </div>
  );
}

/** Keeps the sidebar's "AI live" switch in sync while WhatsApp pages are open. */
function AgentSettingsListener({ onChange }: { onChange: () => void }) {
  useLive((e) => e.type === 'settings' && onChange());
  return null;
}

function NavLink({ item, active, rail }: { item: NavItem; active: boolean; rail: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <Link href={item.href} title={rail ? item.label : item.hint}
        className={`group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium transition ${rail ? 'justify-center' : ''}
          ${active ? 'bg-brand text-white shadow-[0_6px_18px_-8px_var(--brand)]' : 'text-side-ink hover:bg-white/[.06] hover:text-white'}`}>
        <Icon size={18} strokeWidth={active ? 2.3 : 2} className="shrink-0" />
        {!rail && <span className="truncate">{item.label}</span>}
      </Link>
    </li>
  );
}

type Item = { id: string; label: string; hint?: string; icon?: React.ComponentType<{ size?: number }>; conv?: Conversation; run: () => void };

function CommandPalette({ onClose, path, router, sections, hasWa, actions }: {
  onClose: () => void; path: string; router: ReturnType<typeof useRouter>; sections: ReturnType<typeof navFor>; hasWa: boolean;
  actions: { id: string; label: string; icon: React.ComponentType<{ size?: number }>; run: () => void }[];
}) {
  const [q, setQ] = useState('');
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => { if (hasWa) api<Conversation[]>('/api/whatsapp/conversations').then(setConvs).catch(() => {}); }, [hasWa]);

  const items = useMemo<Item[]>(() => {
    const s = q.toLowerCase().trim();
    const match = (t: string) => !s || t.toLowerCase().includes(s);
    const pages: Item[] = sections.flatMap((sec) => sec.items.map((n) => ({ ...n, label: sec.title ? `${sec.title}: ${n.label}` : n.label })))
      .filter((n) => match(n.label))
      .map((n) => ({ id: n.href, label: `Go to ${n.label}`, hint: n.hint, icon: n.icon, run: () => router.push(n.href) }));
    const chats: Item[] = convs
      .filter((c) => match(`${displayName(c)} ${c.phone} ${c.lead?.company ?? ''} ${c.lead?.intent ?? ''} ${c.lastMessagePreview}`))
      .slice(0, 8)
      .map((c) => ({ id: c.id, label: displayName(c), hint: c.lead?.intent || c.phone, conv: c, run: () => openChat(router, path, c.id) }));
    const acts: Item[] = actions.filter((a) => match(a.label));
    return s ? [...chats, ...pages, ...acts] : [...pages, ...chats.slice(0, 5), ...acts];
  }, [q, convs, actions, router, path, sections]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the highlight when the query changes
  useEffect(() => setActive(0), [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const run = (it?: Item) => { if (!it) return; onClose(); it.run(); };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="card anim-pop w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className="text-ink-3" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, chats, actions…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
              else if (e.key === 'Escape') onClose();
            }} />
          <span className="kbd">esc</span>
        </div>
        <ul ref={listRef} className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
          {items.map((it, i) => (
            <li key={it.id + i} data-i={i}>
              <button onMouseMove={() => setActive(i)} onClick={() => run(it)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? 'bg-panel-2' : ''}`}>
                {it.conv ? <Avatar name={it.label} size={26} /> : it.icon ? <span className="grid h-[26px] w-[26px] place-items-center text-ink-2"><it.icon size={16} /></span> : null}
                <span className="min-w-0 flex-1 truncate font-medium">{it.label}</span>
                {it.conv?.lead && <ScoreRing score={it.conv.lead.score} size={22} />}
                {it.hint && <span className="max-w-[40%] truncate text-xs text-ink-3">{it.hint}</span>}
              </button>
            </li>
          ))}
          {!items.length && <li className="px-3 py-8 text-center text-sm text-ink-3">Nothing matches “{q}”.</li>}
        </ul>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-ink-3">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
          <span><span className="kbd">↵</span> open</span>
          <span className="ml-auto"><span className="kbd">⌥</span> <span className="kbd">1–6</span> pages · <span className="kbd">⌘</span> <span className="kbd">K</span> toggle</span>
        </div>
      </div>
    </div>
  );
}

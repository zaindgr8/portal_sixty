'use client';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, RotateCcw, Send, ShieldAlert, Sparkles, Wrench, X } from 'lucide-react';

// The portal assistant: chat on any page, it reads and changes things through the portal's own API
// with your permissions. Anything that changes data or messages a customer waits for your OK.

type Part = Record<string, unknown>;
type Content = { role: 'user' | 'model'; parts: Part[] };
type PendingCall = { id: string; name: string; summary: string; args: Record<string, unknown> };
type Pending = { calls: PendingCall[]; done: Part[] };
type Step = { tool: string; ok: boolean; kind: string; error?: string };
type Turn = { contents: Content[]; reply?: string; pending?: Pending; actions: { navigate?: string }[]; steps: Step[] };
type Bubble =
  | { kind: 'user'; text: string }
  | { kind: 'bot'; text: string; steps: Step[] }
  | { kind: 'confirm'; pending: Pending; steps: Step[]; answered?: 'yes' | 'no' }
  | { kind: 'error'; text: string };

const KEY = 'sixty-assistant';
const SUGGEST = [
  'Which chats need a human right now?',
  'Summarise today\'s hottest leads',
  'Show unread Instagram chats',
  'How many calls did we make this week and how did they go?',
];
const ACTION_LABEL: Record<string, string> = {
  send_message: 'Send message', update_conversation: 'Update chat', add_note: 'Add note', set_ai_agent: 'AI agent', start_call: 'Start call',
  update_call_lead: 'Update lead', update_listing: 'Update listing', publish_listing: 'Publish', unpublish_listing: 'Unpublish', portal_write: 'Change in the portal',
};
const TOOL_LABEL: Record<string, string> = {
  get_overview: 'Checked the overview', list_conversations: 'Looked through chats', get_conversation: 'Read a chat', search_messages: 'Searched messages',
  whatsapp_stats: 'Checked inbox analytics', list_whatsapp_leads: 'Looked at leads', list_team: 'Checked the team', send_message: 'Sent a message',
  update_conversation: 'Updated a chat', add_note: 'Added a note', set_ai_agent: 'Changed the AI agent', list_call_leads: 'Looked at call leads',
  list_calls: 'Looked at calls', get_call: 'Read a call', voice_config: 'Checked voice setup', update_call_lead: 'Updated a lead', start_call: 'Started a call',
  list_listings: 'Looked at listings', get_listing: 'Read a listing', update_listing: 'Updated a listing', publish_listing: 'Published a listing',
  unpublish_listing: 'Unpublished a listing', portal_get: 'Fetched data', portal_write: 'Changed data', open_page: 'Opened a page',
};

function load(): { contents: Content[]; bubbles: Bubble[] } {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '') as { contents: Content[]; bubbles: Bubble[] }; } catch { return { contents: [], bubbles: [] }; }
}

/** Open the assistant from anywhere (sidebar button, mobile header). */
export const openAssistant = () => window.dispatchEvent(new Event('open-assistant'));

export default function AssistantPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contents, setContents] = useState<Content[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const s = load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore this tab's conversation after hydration
    setContents(s.contents); setBubbles(s.bubbles);
  }, []);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify({ contents, bubbles })); } catch { /* storage full or blocked */ } }, [contents, bubbles]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [bubbles, busy, open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-assistant', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-assistant', onOpen); };
  }, []);
  useEffect(() => {
    if (!open) return;
    if (ready === null) fetch('/api/assistant').then((r) => r.json()).then((r: { ready: boolean }) => setReady(r.ready)).catch(() => setReady(false));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, ready]);

  const turn = useCallback(async (payload: object) => {
    setBusy(true);
    try {
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) { setBubbles((b) => [...b, { kind: 'error', text: data.error || 'Something went wrong.' }]); return; }
      const t = data as Turn;
      setContents(t.contents);
      if (t.pending) setBubbles((b) => [...b, { kind: 'confirm', pending: t.pending!, steps: t.steps }]);
      else setBubbles((b) => [...b, { kind: 'bot', text: t.reply ?? '', steps: t.steps }]);
      const nav = t.actions.find((a) => a.navigate)?.navigate;
      if (nav) router.push(nav);
    } catch {
      setBubbles((b) => [...b, { kind: 'error', text: 'Couldn\'t reach the assistant. Check your connection.' }]);
    } finally {
      setBusy(false);
    }
  }, [router]);

  const ask = (msg: string) => {
    const m = msg.trim();
    if (!m || busy) return;
    setText('');
    setBubbles((b) => [...b, { kind: 'user', text: m }]);
    turn({ contents, message: m });
  };
  const answer = (i: number, yes: boolean) => {
    const bub = bubbles[i];
    if (bub?.kind !== 'confirm' || bub.answered) return;
    setBubbles((b) => b.map((x, k) => (k === i ? { ...bub, answered: yes ? 'yes' : 'no' } : x)));
    turn({ contents, confirm: { approved: yes ? bub.pending.calls.map((c) => c.id) : [], pending: bub.pending } });
  };
  const reset = () => { setContents([]); setBubbles([]); };
  const waitingConfirm = bubbles.some((b) => b.kind === 'confirm' && !b.answered);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20 md:bg-transparent" onClick={() => setOpen(false)}>
          <aside onClick={(e) => e.stopPropagation()} aria-label="Sixty assistant"
            className="anim-rise flex h-full w-full flex-col border-l border-line bg-panel shadow-2xl md:w-[440px]">
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-ai-soft text-ai"><Sparkles size={16} /></span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="font-semibold">Ask Sixty</p>
                <p className="text-xs text-ink-3">Reads and updates the portal for you. You approve every change.</p>
              </div>
              {bubbles.length > 0 && <button onClick={reset} title="New conversation" className="rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink"><RotateCcw size={16} /></button>}
              <button onClick={() => setOpen(false)} title="Close (Esc)" className="rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink"><X size={18} /></button>
            </header>

            <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {ready === false && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">The assistant needs a Gemini API key on the server (ASSISTANT_GEMINI_API_KEY or GEMINI_API_KEY).</p>}
              {!bubbles.length && (
                <div className="pt-6 text-center">
                  <p className="font-semibold">What do you need?</p>
                  <p className="mx-auto mb-4 mt-1 max-w-xs text-sm text-ink-2">Ask about chats, leads, calls or listings, or tell it what to change.</p>
                  <div className="space-y-2">
                    {SUGGEST.map((s) => <button key={s} onClick={() => ask(s)} className="block w-full rounded-xl border border-line px-3 py-2 text-left text-sm text-ink-2 hover:border-ai/40 hover:text-ink">{s}</button>)}
                  </div>
                </div>
              )}
              {bubbles.map((b, i) => (
                <Fragment key={i}>
                  {b.kind === 'user' && <div className="ml-10 rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-panel whitespace-pre-wrap">{b.text}</div>}
                  {b.kind === 'error' && <div className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{b.text}</div>}
                  {(b.kind === 'bot' || b.kind === 'confirm') && b.steps.length > 0 && <Steps steps={b.steps} />}
                  {b.kind === 'bot' && <div className="mr-6 rounded-2xl rounded-bl-md bg-panel-2 px-3.5 py-2.5 text-sm"><Rich text={b.text} /></div>}
                  {b.kind === 'confirm' && (
                    <div className="mr-4 rounded-2xl border border-warn/40 bg-warn-soft/60 p-3 text-sm">
                      <p className="mb-2 flex items-center gap-1.5 font-semibold text-warn"><ShieldAlert size={15} />Confirm {b.pending.calls.length > 1 ? `${b.pending.calls.length} actions` : 'this action'}</p>
                      <ul className="mb-3 space-y-1.5">{b.pending.calls.map((c) => <li key={c.id} className="rounded-lg bg-panel px-2.5 py-1.5"><span className="block text-[11px] font-medium uppercase tracking-wide text-ink-3">{ACTION_LABEL[c.name] ?? c.name}</span>{c.summary}</li>)}</ul>
                      {b.answered ? <p className="text-xs text-ink-3">{b.answered === 'yes' ? 'Approved' : 'Declined'}</p> : (
                        <div className="flex gap-2">
                          <button className="btn btn-primary flex-1" disabled={busy} onClick={() => answer(i, true)}><Check size={15} />Approve</button>
                          <button className="btn flex-1" disabled={busy} onClick={() => answer(i, false)}>Decline</button>
                        </div>
                      )}
                    </div>
                  )}
                </Fragment>
              ))}
              {busy && <div className="flex items-center gap-2 text-sm text-ink-3"><Loader2 size={15} className="animate-spin" />Working…</div>}
              <div ref={endRef} />
            </div>

            <form className="border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
              <div className="flex items-end gap-2">
                <textarea ref={inputRef} rows={1} value={text} onChange={(e) => setText(e.target.value)} disabled={waitingConfirm}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }}
                  placeholder={waitingConfirm ? 'Approve or decline above first' : 'Ask or tell Sixty to do something…'}
                  className="input max-h-40 min-h-[42px] resize-none" />
                <button className="btn btn-primary h-[42px] px-3" disabled={busy || !text.trim() || waitingConfirm} aria-label="Send"><Send size={16} /></button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-3">Uses your permissions. ⌘J to open or close.</p>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  const seen = new Map<string, Step & { n: number }>();
  for (const s of steps) { const k = `${s.tool}${s.ok}`; const p = seen.get(k); seen.set(k, p ? { ...p, n: p.n + 1 } : { ...s, n: 1 }); }
  return (
    <div className="flex flex-wrap gap-1">
      {[...seen.values()].map((s) => (
        <span key={`${s.tool}${s.ok}`} title={s.error} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${s.ok ? 'bg-panel-2 text-ink-3' : 'bg-danger-soft text-danger'}`}>
          <Wrench size={10} />{TOOL_LABEL[s.tool] ?? s.tool}{s.n > 1 ? ` ×${s.n}` : ''}{!s.ok && (s.error === 'declined' ? ' (declined)' : ' (failed)')}
        </span>
      ))}
    </div>
  );
}

/** Tiny markdown: paragraphs, bullet/numbered lists, tables, **bold** and `code`. No HTML is ever injected. */
function Rich({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
        i++;
      }
      i--;
      out.push(
        <div key={i} className="my-1.5 overflow-x-auto"><table className="w-full text-xs">
          <tbody>{rows.map((r, k) => <tr key={k} className={k ? 'border-t border-line' : 'font-semibold'}>{r.map((c, j) => <td key={j} className="py-1 pr-2 align-top">{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
    } else if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
      out.push(<div key={i} className="flex gap-1.5 pl-1"><span className="text-ink-3">{/^\s*\d+\./.test(l) ? l.trim().split(/\s/)[0] : '•'}</span><span className="min-w-0 flex-1">{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''))}</span></div>);
    } else if (/^#{1,4}\s/.test(l)) {
      out.push(<p key={i} className="mt-1 font-semibold">{inline(l.replace(/^#+\s/, ''))}</p>);
    } else if (l.trim()) out.push(<p key={i} className="my-0.5">{inline(l)}</p>);
    else out.push(<div key={i} className="h-1.5" />);
  }
  return <>{out}</>;
}

function inline(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g).map((p, i) => {
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    // Only links inside the portal become clickable.
    if (link) return link[2].startsWith('/') && !link[2].startsWith('//') ? <a key={i} href={link[2]} className="font-medium text-ai underline">{link[1]}</a> : <Fragment key={i}>{link[1]}</Fragment>;
    return p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p.startsWith('`') && p.endsWith('`') ? <code key={i} className="rounded bg-panel px-1 text-[12px]">{p.slice(1, -1)}</code>
      : <Fragment key={i}>{p}</Fragment>;
  });
}

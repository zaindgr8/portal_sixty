"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow, ArrowLeft, Bot, Building2, Check, CheckCheck, CheckCircle2, ChevronDown, Clock, FileText, Globe, Hand, Loader2,
  Mail, MessageCircle, MinusCircle, PanelRight, PlusCircle, RefreshCw, Search, Send, Smile, Sparkles, SquarePen, StickyNote, Target, Timer, TriangleAlert, User, UserPlus, Wallet, X,
} from "lucide-react";
import { api, displayName, priorityRank, STAGE_META, timeAgo, useAgentName, useLive, waitingSince, waitTone } from "@/lib/whatsapp/client";
import { LEAD_STAGES, type Agent, type Conversation, type Lead, type Message, type Note } from "@/lib/whatsapp/types";
import type { SessionUser } from "@/lib/auth/modules";
import { Avatar, ChannelBadge, PriorityBadge, ScoreRing, StageChip } from "@/components/whatsapp/ui";
import NewMessage from "@/components/whatsapp/NewMessage";

/** sessionOpen: free replies allowed (24h). lateReply: Instagram, 24h–7d, a person may still reply (Human Agent). */
type Conv = Conversation & { sessionOpen: boolean; lateReply?: boolean };
type Template = { sid: string; name: string; language: string; status: string; variables: Record<string, string> };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "waiting", label: "Waiting" },
  { key: "hot", label: "Hot" },
  { key: "human", label: "Needs human" },
  { key: "ai", label: "AI" },
  { key: "manual", label: "Manual" },
  { key: "resolved", label: "Resolved" },
] as const;
// Channel is its own switch, so it combines with the filters above (e.g. Instagram + Unread).
const CHANNELS = [
  { key: "all", label: "All channels" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
] as const;
type ChannelKey = (typeof CHANNELS)[number]["key"];
function InstagramGlyph({ active }: { active: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={active ? "#e1306c" : "currentColor"} strokeWidth="2.2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" />
    </svg>
  );
}
const channelOf = (c: { channel?: string }): ChannelKey => (c.channel === "instagram" ? "instagram" : "whatsapp");
type FilterKey = (typeof FILTERS)[number]["key"];
type View = "all" | "mine" | "unassigned";
type Scoring = { gemini: boolean; model: string | null; running: boolean; total: number; done: number; failed: number; lastError?: string };

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function readPref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
}
function writePref(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch {}
}

export default function Inbox() {
  const agentName = useAgentName();
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [channel, setChannel] = useState<ChannelKey>("all");
  const [sort, setSort] = useState<"recent" | "priority">("recent");
  const [view, setView] = useState<View>("all");
  const [me, setMe] = useState<SessionUser | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [scoring, setScoring] = useState<Scoring | null>(null);
  // Ticks every minute so "waiting" timers and the priority order stay current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(() => api<Conv[]>("/api/whatsapp/conversations").then(setConvs).catch(() => {}), []);
  const loadAgents = useCallback(() => api<Agent[]>("/api/whatsapp/team").then(setAgents).catch(() => {}), []);
  const loadScoring = useCallback(() => api<Scoring>("/api/whatsapp/scoring").then(setScoring).catch(() => {}), []);
  useEffect(() => {
    loadList();
    loadAgents();
    loadScoring();
    api<SessionUser>("/api/me").then((u) => {
      setMe(u);
      // Agents land on their own chats; owners/admins on everything (unless they chose otherwise).
      setView(readPref<View>("inbox.view", u.role === "member" ? "mine" : "all"));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore saved preferences after hydration
    setSort(readPref<string>("inbox.sort", "recent") === "recent" ? "recent" : "priority");
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSelected(c);
  }, [loadList, loadAgents, loadScoring]);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id); else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }, []);

  // The command palette opens chats through this event.
  useEffect(() => {
    const on = (e: Event) => select((e as CustomEvent<string>).detail);
    window.addEventListener("open-chat", on);
    return () => window.removeEventListener("open-chat", on);
  }, [select]);

  useLive((e) => {
    if (e.type === "team") loadAgents();
    if (e.type !== "hello" && e.type !== "agent" && e.type !== "note") loadList();
  });
  // While Gemini (re-)scores chats in the background, show progress and refresh the list.
  useEffect(() => {
    if (!scoring?.running) return;
    const t = setInterval(() => { loadScoring(); loadList(); }, 4000);
    return () => clearInterval(t);
  }, [scoring?.running, loadScoring, loadList]);

  const flash = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ imported: number }>("/api/whatsapp/sync", { method: "POST", json: {} });
      flash(`Synced ${r.imported} messages from Twilio`);
      loadList();
    } catch (e) { flash((e as Error).message); }
    setSyncing(false);
  };

  const list = useMemo(() => convs ?? [], [convs]);
  const isHot = (c: Conv) => c.status === "open" && (c.lead?.stage === "hot" || c.lead?.priority === "P1");
  // "Unassigned" is a to-do list: open chats where the customer has written and nobody owns them yet
  // (outreach nobody has replied to doesn't need an owner).
  const needsOwner = (c: Conv) => !c.assignee && c.status === "open" && Boolean(c.lastInboundAt);
  const inView = useCallback((c: Conv) => (channel === "all" || channelOf(c) === channel) && (view === "all" || (view === "mine" ? c.assignee === me?.username : needsOwner(c))), [view, me, channel]);
  const counts = useMemo(() => {
    const v = list.filter(inView);
    return {
      unread: v.filter((c) => c.unread > 0).length,
      waiting: v.filter((c) => waitingSince(c)).length,
      hot: v.filter(isHot).length,
      human: v.filter((c) => c.needsHuman).length,
      open: list.filter((c) => c.status === "open").length,
      mine: list.filter((c) => c.assignee === me?.username && c.status === "open").length,
      unassigned: list.filter(needsOwner).length,
    };
  }, [list, inView, me]);
  const channelCounts = useMemo(() => ({
    all: list.length,
    whatsapp: list.filter((c) => channelOf(c) === "whatsapp").length,
    instagram: list.filter((c) => channelOf(c) === "instagram").length,
  }), [list]);
  const teammateName = useMemo(() => new Map(agents.map((a) => [a.username, a.name])), [agents]);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    const out = list.filter((c) => {
      if (!inView(c)) return false;
      if (q && !`${displayName(c)} ${c.phone} ${c.lastMessagePreview} ${c.lead?.company ?? ""} ${c.lead?.intent ?? ""} ${c.lead?.summary ?? ""} ${c.tags.join(" ")} ${(c.lead?.aiTags ?? []).join(" ")}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "unread": return c.unread > 0;
        case "waiting": return Boolean(waitingSince(c));
        case "hot": return isHot(c);
        case "human": return c.needsHuman;
        case "ai": return c.aiEnabled && c.status === "open";
        case "manual": return !c.aiEnabled && c.status === "open";
        case "resolved": return c.status === "resolved";
        default: return true;
      }
    });
    if (sort === "priority") out.sort((a, b) => priorityRank(b, now) - priorityRank(a, now));
    return out;
  }, [list, filter, query, sort, inView, now]);

  const current = list.find((c) => c.id === selected) ?? null;

  // Keyboard: J/K or ↓/↑ move through chats, / searches, Esc closes the chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && document.activeElement === searchRef.current) { searchRef.current?.blur(); return; }
      if (isTyping(e.target) || document.querySelector("[data-modal]")) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "Escape") { select(null); return; }
      const step = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (!step || !visible.length) return;
      e.preventDefault();
      const i = visible.findIndex((c) => c.id === selected);
      const next = visible[Math.max(0, Math.min(visible.length - 1, i < 0 ? 0 : i + step))];
      select(next.id);
      document.querySelector(`[data-conv="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected, select]);

  const toggleSort = () => { const s = sort === "recent" ? "priority" : "recent"; setSort(s); writePref("inbox.sort", s); };
  const chooseView = (v: View) => { setView(v); writePref("inbox.view", v); };

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <section className={`${selected ? "hidden md:flex" : "flex"} w-full flex-col border-r border-line bg-panel md:w-[340px] md:shrink-0`}>
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
          {convs && <span className="text-xs tabular-nums text-ink-3">{visible.length}</span>}
          <button onClick={toggleSort} className="btn btn-ghost ml-auto px-2 py-1.5 text-xs" title="Change sort order">
            <ArrowDownWideNarrow size={14} /> {sort === "recent" ? "Recent" : "Priority"}
          </button>
          <button onClick={sync} disabled={syncing} className="btn btn-ghost px-2 py-1.5 text-xs" title="Import past messages from Twilio">
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> Sync
          </button>
          <button onClick={() => setComposing(true)} className="btn btn-primary h-8 w-8 p-0" title="New WhatsApp message" aria-label="New WhatsApp message">
            <SquarePen size={15} />
          </button>
        </div>
        <div className="px-4 pb-2">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-panel-2 p-1 text-xs font-medium" role="tablist">
            {([["all", "All", counts.open], ["mine", "Mine", counts.mine], ["unassigned", "Unassigned", counts.unassigned]] as const).map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => chooseView(k)}
                className={`flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 transition ${view === k ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-3 hover:text-ink"}`}>
                <span className="truncate">{label}</span>
                <span className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums leading-none ${view === k ? "bg-brand-soft text-brand" : "bg-panel/70 text-ink-3"}`}>{n}</span>
              </button>
            ))}
          </div>
        </div>
        {scoring?.running && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-ai-soft px-3 py-2 text-xs text-ai">
            <Sparkles size={14} className="shrink-0 animate-pulse" />
            <span className="min-w-0 flex-1">Gemini is scoring your chats… <b className="tabular-nums">{scoring.done}/{scoring.total}</b></span>
          </div>
        )}
        {scoring && !scoring.running && scoring.failed > 0 && scoring.failed === scoring.done && (
          <div className="mx-4 mb-2 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger" title={scoring.lastError}>Gemini scoring failed: {scoring.lastError}</div>
        )}
        <div className="px-4 pb-2">
          <label className="relative block">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input ref={searchRef} className="input pl-9 pr-9" placeholder="Search leads, companies, messages" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="kbd absolute right-2.5 top-1/2 hidden -translate-y-1/2 md:inline-grid">/</span>
          </label>
        </div>
        <div className="px-4 pb-2" role="tablist" aria-label="Channel">
          <div className="grid grid-cols-[auto_1fr_1fr] rounded-xl bg-panel-2 p-0.5 text-[11.5px] font-medium">
            {CHANNELS.map((ch) => (
              <button key={ch.key} role="tab" aria-selected={channel === ch.key} onClick={() => setChannel(ch.key)}
                title={`${ch.label}: ${channelCounts[ch.key]} chats`}
                className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-1 py-1.5 transition ${channel === ch.key ? "bg-panel text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>
                {ch.key === "whatsapp" && <MessageCircle size={12} className={`shrink-0 ${channel === ch.key ? "text-ok" : ""}`} />}
                {ch.key === "instagram" && <span className="shrink-0"><InstagramGlyph active={channel === ch.key} /></span>}
                <span className="whitespace-nowrap">{ch.key === "all" ? "All" : ch.label}</span>
                <span className="text-[10px] tabular-nums text-ink-3">{channelCounts[ch.key]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="scroll-thin flex gap-1.5 overflow-x-auto px-4 pb-3">
          {FILTERS.map((f) => {
            const n = f.key === "unread" ? counts.unread : f.key === "human" ? counts.human : f.key === "hot" ? counts.hot : f.key === "waiting" ? counts.waiting : 0;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium transition ${filter === f.key ? "bg-ink text-panel" : "bg-panel-2 text-ink-2 hover:text-ink"}`}>
                {f.key === "ai" ? agentName : f.label}{n > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${f.key === "human" || f.key === "waiting" ? "bg-warn text-panel" : "bg-brand text-brand-ink"}`}>{n}</span>}
              </button>
            );
          })}
        </div>
        <ul className="scroll-thin flex-1 overflow-y-auto">
          {!convs && Array.from({ length: 7 }, (_, i) => (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className="skeleton h-[42px] w-[42px] shrink-0 rounded-full" />
              <span className="flex-1 space-y-2 pt-1"><span className="skeleton block h-3 w-2/3" /><span className="skeleton block h-3 w-full" /></span>
            </li>
          ))}
          {visible.map((c) => { const w = waitingSince(c); const owner = c.assignee ? teammateName.get(c.assignee) ?? c.assignee : ""; return (
            <li key={c.id}>
              <button onClick={() => select(c.id)} data-conv={c.id}
                className={`relative flex w-full gap-3 px-4 py-3 text-left transition ${selected === c.id ? "bg-brand-soft/70" : "hover:bg-panel-2"}`}>
                {selected === c.id && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-brand" />}
                <span className="relative">
                  <Avatar name={displayName(c)} />
                  <ChannelBadge channel={c.channel} />
                  {c.lead && <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel ${STAGE_META[c.lead.stage].dot}`} title={STAGE_META[c.lead.stage].label} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{displayName(c)}</span>
                    <span className={`shrink-0 text-[11px] tabular-nums ${c.unread ? "font-medium text-brand" : "text-ink-3"}`}>{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  {(c.lead?.intent || c.lead?.priority) && (
                    <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                      {c.lead?.priority && <PriorityBadge priority={c.lead.priority} />}
                      <span className="truncate">{c.lead?.intent}{c.lead?.company ? ` · ${c.lead.company}` : ""}</span>
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-[13px] text-ink-3">{c.lastMessagePreview || "No messages"}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {w && <span title={`Waiting for a reply since ${new Date(w).toLocaleString()}`} className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums ${waitTone(w, c.lead?.priority)}`}><Timer size={10} />{timeAgo(w)}</span>}
                      {c.needsHuman && <span title="Needs a human" className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">HUMAN</span>}
                      {owner && <span title={`Assigned to ${owner}`}><Avatar name={owner} size={18} /></span>}
                      {c.aiEnabled ? <Bot size={14} className="text-ai" aria-label={`${agentName} on`} /> : <User size={14} className="text-ink-3" aria-label="Manual" />}
                      {c.lead && <ScoreRing score={c.lead.score} size={22} />}
                      {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-semibold text-brand-ink">{c.unread}</span>}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ); })}
          {convs && !visible.length && (
            <li className="px-6 py-16 text-center text-sm text-ink-3">
              {!list.length ? "No chats yet. When someone messages your WhatsApp number, it appears here — or click Sync to import history."
                : view === "mine" ? "Nothing assigned to you right now." : view === "unassigned" ? "Every open chat has an owner. 🎉" : "No chats match this filter."}
            </li>
          )}
        </ul>
        <div className="hidden gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-3 md:flex">
          <span><span className="kbd">J</span> <span className="kbd">K</span> move</span>
          <span><span className="kbd">/</span> search</span>
          <span className="ml-auto"><span className="kbd">⌘</span> <span className="kbd">K</span> jump</span>
        </div>
      </section>

      {/* Thread */}
      {current ? (
        <Thread key={current.id} conv={current} agents={agents} me={me} onBack={() => select(null)} onChanged={loadList} flash={flash}
          setLocal={(p) => setConvs((cs) => cs?.map((c) => (c.id === current.id ? { ...c, ...p } : c)) ?? cs)} />
      ) : (
        <div className="chat-wallpaper hidden flex-1 place-items-center md:grid">
          <div className="anim-rise text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-panel text-brand shadow-[var(--shadow)]"><Target size={28} /></div>
            <p className="font-semibold">Pick a lead to start</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-ink-2">Watch {agentName} qualify leads live, take over any chat, or hand it back.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {counts.hot > 0 && (
                <button onClick={() => { setFilter("hot"); setSort("priority"); }} className="btn text-xs">
                  <span className="h-2 w-2 rounded-full bg-brand" /> {counts.hot} hot {counts.hot === 1 ? "lead" : "leads"}
                </button>
              )}
              {counts.waiting > 0 && (
                <button onClick={() => { setFilter("waiting"); setSort("priority"); }} className="btn text-xs">
                  <Timer size={13} className="text-warn" /> {counts.waiting} waiting for a reply
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {composing && (
        <NewMessage convs={convs ?? []} onClose={() => setComposing(false)}
          onSent={async (id) => { setComposing(false); await loadList(); select(id); flash("Message sent"); }} />
      )}
      {toast && <div className="anim-rise fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm text-panel shadow-lg">{toast}</div>}
    </div>
  );
}

function Thread({ conv, agents, me, onBack, onChanged, flash, setLocal }: {
  conv: Conv; agents: Agent[]; me: SessionUser | null; onBack: () => void; onChanged: () => void; flash: (m: string) => void; setLocal: (p: Partial<Conv>) => void;
}) {
  const agentName = useAgentName();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [mode, setMode] = useState<"reply" | "note" | "brief">("reply");
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<Message[]>([]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a saved preference after hydration
  useEffect(() => { setShowLead(readPref("inbox.leadPanel", window.innerWidth >= 1280 ? "1" : "0") === "1"); }, []);
  const toggleLead = () => setShowLead((s) => { writePref("inbox.leadPanel", s ? "0" : "1"); return !s; });

  const load = useCallback(() => {
    api<{ messages: Message[] }>(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}`)
      .then((r) => setMessages([...r.messages, ...pendingRef.current]))
      .catch(() => {});
  }, [conv.id]);
  const loadNotes = useCallback(() => {
    api<Note[]>(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}/notes`).then(setNotes).catch(() => {});
  }, [conv.id]);

  const patch = useCallback(async (p: Partial<Conversation>) => {
    setLocal(p as Partial<Conv>); // optimistic
    await api(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}`, { method: "PATCH", json: p }).catch((e) => flash(e.message));
    onChanged();
  }, [conv.id, flash, onChanged, setLocal]);

  useEffect(() => {
    load();
    loadNotes();
    if (conv.unread) patch({ unread: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  useLive((e) => {
    if (e.type === "note" && e.conversationId === conv.id) { loadNotes(); return; }
    if (e.conversationId === conv.id || e.type === "poll") {
      if (e.type === "conversation") loadNotes(); // assignment events
      if (e.type === "conversation" || e.type === "agent") return; // the list reload already covers these
      load();
      if (e.type === "message" && document.visibilityState === "visible")
        api(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}`, { method: "PATCH", json: { unread: 0 } }).catch(() => {});
    }
  });

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages?.length]);

  // E resolves/reopens, R focuses the reply box, I toggles the lead panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("[data-modal]")) return;
      if (e.key === "e") patch({ status: conv.status === "open" ? "resolved" : "open" });
      else if (e.key === "r") { e.preventDefault(); setMode("reply"); inputRef.current?.focus(); }
      else if (e.key === "n") { e.preventDefault(); setMode("note"); inputRef.current?.focus(); }
      else if (e.key === "b") { e.preventDefault(); setMode("brief"); }
      else if (e.key === "i") toggleLead();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const saveNote = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    try {
      const n = await api<Note>(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}/notes`, { method: "POST", json: { body } });
      setNotes((ns) => [...ns.filter((x) => x.id !== n.id), n]);
    } catch (e) { flash((e as Error).message); setDraft(body); }
  };

  const send = async (extra?: { contentSid: string }) => {
    if (!extra && mode === "note") return saveNote();
    const body = draft.trim();
    if (!extra && !body) return;
    // Show the message immediately; it settles once Twilio accepts it.
    const temp: Message = {
      id: `pending_${crypto.randomUUID()}`, conversationId: conv.id, direction: "outbound", author: "agent",
      body: extra ? "Template message" : body, media: [], status: "sending", createdAt: new Date().toISOString(),
    };
    pendingRef.current = [...pendingRef.current, temp];
    setMessages((m) => [...(m ?? []), temp]);
    setDraft("");
    if (conv.aiEnabled) { setLocal({ aiEnabled: false }); flash(`You took over — ${agentName} paused for this chat`); }
    try {
      await api(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}/messages`, { method: "POST", json: extra ?? { body } });
    } catch (e) {
      flash((e as Error).message);
      if (!extra) setDraft(body);
    }
    pendingRef.current = pendingRef.current.filter((m) => m.id !== temp.id);
    load();
    onChanged();
  };

  const aiDraft = async () => {
    setDrafting(true);
    try {
      const r = await api<{ text: string; handoff: boolean; reason?: string }>(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}/suggest`, { method: "POST" });
      if (r.handoff) flash(`AI suggests a human handles this: ${r.reason}`);
      else { setDraft(r.text); inputRef.current?.focus(); }
    } catch (e) { flash((e as Error).message); }
    setDrafting(false);
  };

  const openTemplates = async () => {
    try { setTemplates(await api<Template[]>("/api/whatsapp/templates")); } catch (e) { flash((e as Error).message); }
  };

  const name = displayName(conv);
  const groups = groupByDay(messages ?? [], notes);
  // @mention suggestions while writing a note.
  const mentionQ = mode === "note" ? /(?:^|\s)@([a-z0-9._-]*)$/i.exec(draft)?.[1]?.toLowerCase() : undefined;
  const mentionHits = mentionQ !== undefined ? agents.filter((a) => a.active && (a.username.includes(mentionQ) || a.name.toLowerCase().includes(mentionQ))).slice(0, 5) : [];

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-panel px-3 py-2.5 md:px-5">
          <button onClick={onBack} className="rounded-lg p-1.5 text-ink-2 hover:bg-panel-2 md:hidden" aria-label="Back"><ArrowLeft size={20} /></button>
          <button onClick={toggleLead} className="flex min-w-0 items-center gap-3 text-left">
            <span className="relative"><Avatar name={name} size={38} /><ChannelBadge channel={conv.channel} /></span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{name}</span>
                {conv.lead && <StageChip stage={conv.lead.stage} className="hidden sm:inline-flex" />}
              </span>
              <span className="block truncate text-xs text-ink-3">{conv.channel === "instagram" ? "Instagram" : conv.phone}{conv.lead?.company ? ` · ${conv.lead.company}` : conv.profileName && conv.name ? ` · ${conv.profileName}` : ""}</span>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <AssignMenu conv={conv} agents={agents} me={me} onAssign={(username) => patch({ assignee: username } as unknown as Partial<Conversation>)} />
            <button onClick={() => setMode("brief")}
              title={conv.aiInstructions ? `${conv.aiInstructionsMode === "replace" ? `${agentName}'s own brief for this person` : `Extra instructions for ${agentName}`}:\n${conv.aiInstructions}` : `Give ${agentName} a custom brief for this person`}
              className={`hidden items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold md:inline-flex ${conv.aiInstructions ? "bg-ai-soft text-ai" : "border border-dashed border-line text-ink-3 hover:border-ai hover:text-ai"}`}>
              <Sparkles size={13} /> {conv.aiInstructions ? (conv.aiInstructionsMode === "replace" ? "Own brief" : "Custom") : "Brief"}
            </button>
            <AiSwitch name={agentName} on={conv.aiEnabled} onChange={(v) => patch({ aiEnabled: v, ...(v ? { needsHuman: false } : {}) })} />
            <button onClick={() => patch({ status: conv.status === "open" ? "resolved" : "open" })}
              className="btn hidden px-2.5 py-1.5 text-xs sm:inline-flex" title={`${conv.status === "open" ? "Mark resolved" : "Reopen"}  (E)`}>
              <CheckCircle2 size={14} className={conv.status === "resolved" ? "text-ok" : ""} />
              {conv.status === "open" ? "Resolve" : "Reopen"}
            </button>
            <button onClick={toggleLead} className={`btn px-2 py-1.5 ${showLead ? "bg-panel-2" : ""}`} title="Lead details  (I)" aria-pressed={showLead}>
              <PanelRight size={16} />
            </button>
          </div>
        </header>

        {conv.needsHuman && (
          <div className="flex items-center gap-2 border-b border-line bg-warn-soft px-5 py-2 text-sm text-warn">
            <Hand size={16} className="shrink-0" />
            <span className="min-w-0 flex-1"><b>Needs a human.</b> {conv.handoffReason}</span>
            <button onClick={() => patch({ aiEnabled: true, needsHuman: false })} className="shrink-0 text-xs font-semibold underline">Give back to AI</button>
          </div>
        )}

        <div className="chat-wallpaper scroll-thin flex-1 overflow-y-auto px-3 py-4 md:px-8">
          {!messages && (
            <div className="space-y-3 pt-4">
              {[60, 40, 70, 35].map((w, i) => <div key={i} className={`flex ${i % 2 ? "justify-end" : ""}`}><span className="skeleton block h-12" style={{ width: `${w}%` }} /></div>)}
            </div>
          )}
          {groups.map(([day, items]) => (
            <div key={day}>
              <div className="pointer-events-none sticky top-2 z-10 my-3 flex justify-center"><span className="rounded-full border border-line bg-panel px-3 py-1 text-[11px] font-medium text-ink-2 shadow-md">{day}</span></div>
              {items.map((m) => ("kind" in m ? <NoteBubble key={m.id} n={m} /> : <Bubble key={m.id} m={m} agentName={agentName} />))}
            </div>
          ))}
          {messages && !messages.length && <p className="mt-20 text-center text-sm text-ink-3">No messages yet.</p>}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <footer className="border-t border-line bg-panel px-3 py-3 md:px-5">
          <div className="mb-2 flex items-center gap-1 text-xs font-medium">
            <button onClick={() => setMode("reply")} className={`rounded-lg px-2.5 py-1 transition ${mode === "reply" ? "bg-panel-2 text-ink" : "text-ink-3 hover:text-ink"}`}>Reply</button>
            <button onClick={() => { setMode("note"); inputRef.current?.focus(); }} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition ${mode === "note" ? "bg-warn-soft text-warn" : "text-ink-3 hover:text-ink"}`}>
              <StickyNote size={13} /> Internal note
            </button>
            <button onClick={() => setMode("brief")} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition ${mode === "brief" ? "bg-ai-soft text-ai" : "text-ink-3 hover:text-ink"}`}>
              <Sparkles size={13} /> Brief for {agentName}
              {conv.aiInstructions && <span className="h-1.5 w-1.5 rounded-full bg-ai" />}
            </button>
            {mode === "note" && <span className="ml-2 text-[11px] font-normal text-ink-3">Only your team sees this. Type @ to mention someone.</span>}
            {mode === "brief" && <span className="ml-2 hidden text-[11px] font-normal text-ink-3 lg:inline">Never sent to the customer. Tells {agentName} how to handle this person.</span>}
          </div>
          {mode === "brief" ? (
            <AgentInstructions key={conv.id} conv={conv} agentName={agentName} onSave={async (p) => { await patch(p); flash(p.aiInstructions ? `${agentName} will follow the new brief from her next reply` : "Brief removed"); }} />
          ) : mode === "reply" && !conv.sessionOpen && conv.lastInboundAt && !conv.lateReply ? (
            conv.channel === "instagram" ? (
              <div className="flex items-center gap-3 rounded-xl bg-panel-2 px-4 py-3 text-sm">
                <Clock size={16} className="text-warn" />
                <span className="flex-1 text-ink-2">Instagram only allows replies within 7 days of the customer&apos;s last message. You can message again once they write to you.</span>
              </div>
            ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-4 py-3 text-sm">
              <Clock size={16} className="text-warn" />
              <span className="flex-1 text-ink-2">The 24-hour WhatsApp window is closed. You can only send an approved template until the customer replies.</span>
              <button onClick={openTemplates} className="btn btn-primary py-1.5 text-xs"><FileText size={14} /> Send template</button>
            </div>
            )
          ) : (
            <div className="relative flex items-end gap-2">
              {mentionHits.length > 0 && (
                <ul className="card absolute bottom-12 left-12 z-20 w-56 overflow-hidden py-1 text-sm shadow-lg">
                  {mentionHits.map((a) => (
                    <li key={a.username}>
                      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel-2"
                        onClick={() => { setDraft((d) => d.replace(/@([a-z0-9._-]*)$/i, `@${a.username} `)); inputRef.current?.focus(); }}>
                        <Avatar name={a.name} size={20} /><span className="truncate">{a.name}</span><span className="ml-auto text-xs text-ink-3">@{a.username}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {mode === "reply" && <button onClick={aiDraft} disabled={drafting} className="btn h-10 shrink-0 px-2.5 text-ai" title="Draft a reply with AI (you review before sending)">
                {drafting ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              </button>}
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  else if (e.key === "Escape") inputRef.current?.blur();
                }}
                rows={Math.min(5, Math.max(1, draft.split("\n").length))}
                placeholder={mode === "note" ? "Write an internal note…" : conv.aiEnabled ? `Type to take over from ${agentName}…` : "Type a message"}
                className={`input scroll-thin max-h-40 min-h-10 resize-none py-2.5 ${mode === "note" ? "border-warn/40 bg-warn-soft/40" : ""}`}
              />
              <button onClick={() => send()} disabled={!draft.trim()} className={`btn h-10 w-10 shrink-0 p-0 ${mode === "note" ? "bg-warn text-white" : "btn-primary"}`} aria-label={mode === "note" ? "Save note" : "Send"}>
                {mode === "note" ? <StickyNote size={17} /> : <Send size={17} />}
              </button>
            </div>
          )}
          {mode === "reply" && conv.lateReply && (
            <p className="mt-1.5 text-[11px] text-warn">Over 24 hours since their last message: you can still reply yourself for up to 7 days (sent as a teammate). {agentName} can&apos;t reply until they write again.</p>
          )}
          <p className="mt-1.5 hidden text-[11px] text-ink-3 md:block">
            {conv.aiEnabled ? `${agentName} is replying automatically. Sending a message yourself pauses ${agentName} for this chat.` : `${agentName} is off for this chat — you're in control.`}
            <span className="ml-2 opacity-70"><span className="kbd">R</span> reply · <span className="kbd">N</span> note · <span className="kbd">B</span> brief · <span className="kbd">E</span> resolve · <span className="kbd">I</span> lead</span>
          </p>
        </footer>
      </section>

      {showLead && <LeadPanel conv={conv} onClose={toggleLead} onSave={patch} flash={flash} onChanged={onChanged} />}

      {templates && (
        <div data-modal className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]" onClick={() => setTemplates(null)}>
          <div className="card anim-pop max-h-[70vh] w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h3 className="font-semibold">Approved templates</h3>
              <button onClick={() => setTemplates(null)} className="text-ink-3"><X size={18} /></button>
            </div>
            <ul className="scroll-thin max-h-[55vh] overflow-y-auto">
              {templates.map((t) => (
                <li key={t.sid} className="flex items-center gap-3 border-b border-line px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="text-xs text-ink-3">{t.language} · {t.status}</div>
                  </div>
                  <button className="btn py-1 text-xs" onClick={() => { setTemplates(null); send({ contentSid: t.sid }); }}>Send</button>
                </li>
              ))}
              {!templates.length && <li className="px-5 py-10 text-center text-sm text-ink-3">No templates found. Create one in Twilio Console → Content Template Builder.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignMenu({ conv, agents, me, onAssign }: { conv: Conv; agents: Agent[]; me: SessionUser | null; onAssign: (username: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const owner = agents.find((a) => a.username === conv.assignee);
  const pick = (u: string | null) => { setOpen(false); if (u !== (conv.assignee ?? null)) onAssign(u); };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn px-2.5 py-1.5 text-xs" title="Who handles this chat">
        {owner ? <Avatar name={owner.name} size={18} /> : <UserPlus size={14} />}
        <span className="hidden max-w-24 truncate sm:inline">{owner ? owner.name : conv.assignee || "Assign"}</span>
        <ChevronDown size={12} className="text-ink-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <ul className="card anim-pop absolute right-0 z-40 mt-1 w-64 overflow-hidden py-1 text-sm shadow-lg">
            {me && conv.assignee !== me.username && agents.some((a) => a.username === me.username) && (
              <li><button onClick={() => pick(me.username)} className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-brand hover:bg-panel-2"><UserPlus size={15} /> Assign to me</button></li>
            )}
            {agents.filter((a) => a.active).map((a) => (
              <li key={a.username}>
                <button onClick={() => pick(a.username)} className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel-2 ${a.username === conv.assignee ? "bg-brand-soft/60" : ""}`}>
                  <span className="relative"><Avatar name={a.name} size={24} /><span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel ${a.available ? "bg-ok" : "bg-ink-3"}`} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate">{a.name}</span><span className="block text-[11px] text-ink-3">{a.available ? "Available" : "Away"} · {a.open} open</span></span>
                  {a.username === conv.assignee && <Check size={15} className="text-brand" />}
                </button>
              </li>
            ))}
            {conv.assignee && <li className="border-t border-line"><button onClick={() => pick(null)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-ink-2 hover:bg-panel-2"><X size={15} /> Unassign</button></li>}
            {agents.length <= 1 && <li className="border-t border-line px-3 py-2 text-[11px] text-ink-3">Add teammates on the Team page.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function NoteBubble({ n }: { n: Note }) {
  const time = new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (n.kind === "event") {
    return <div className="my-2 text-center"><span className="rounded-full bg-panel/90 px-3 py-1 text-[11px] text-ink-3 shadow-sm">{n.body} · {time}</span></div>;
  }
  const parts = n.body.split(/(@[a-z0-9._-]+)/gi);
  return (
    <div className="anim-rise mb-1.5 flex justify-center">
      <div className="w-full max-w-[85%] rounded-2xl border border-warn/30 bg-warn-soft px-3 py-2 md:max-w-[65%]">
        <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-warn"><StickyNote size={12} /> Note · {n.authorName}</div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">
          {parts.map((p, i) => (p.startsWith("@") ? <b key={i} className="text-warn">{p}</b> : p))}
        </p>
        <div className="mt-0.5 text-right text-[10.5px] text-ink-3">{time}</div>
      </div>
    </div>
  );
}

function AiSwitch({ name, on, onChange }: { name: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} title={on ? `${name} is replying — click to take over` : `You're in control — click to hand back to ${name}`}
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${on ? "border-transparent bg-ai-soft text-ai" : "border-line bg-panel text-ink-2"}`}>
      {on ? <AgentAvatar name={name} size={16} /> : <User size={14} />}
      <span className="hidden sm:inline">{on ? `${name} on` : "Manual"}</span>
      <span className={`relative h-4 w-7 rounded-full transition ${on ? "bg-ai" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** The agent as a character: her initial in a small badge. */
function AgentAvatar({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-ai font-bold text-white" style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Bubble({ m, agentName }: { m: Message; agentName: string }) {
  const out = m.direction === "outbound";
  const bg = !out ? "bg-bubble-in" : m.author === "ai" ? "bg-bubble-ai" : "bg-bubble-out";
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`anim-rise mb-1.5 flex ${out ? "justify-end" : "justify-start"} ${m.status === "sending" ? "opacity-70" : ""}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-[0_1px_0.5px_rgba(0,0,0,0.08)] md:max-w-[65%] ${bg} ${out ? "rounded-tr-md" : "rounded-tl-md"}`}>
        {out && (
          <div className={`mb-0.5 flex items-center gap-1 text-[11px] font-semibold ${m.author === "ai" ? "text-ai" : "text-brand"}`}>
            {m.author === "ai" ? <><AgentAvatar name={agentName} size={16} /> {agentName}</> : <><User size={12} /> You</>}
          </div>
        )}
        {m.media.map((x, i) => <MediaView key={i} url={x.url} type={x.contentType} />)}
        {m.body && <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">{m.body}</p>}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-ink-3">
          {time}
          {out && <StatusTick status={m.status} />}
        </div>
        {m.error && <p className="mt-1 flex items-center gap-1 text-[11px] text-danger"><TriangleAlert size={12} /> {m.error}</p>}
      </div>
    </div>
  );
}

function StatusTick({ status }: { status: string }) {
  if (status === "read") return <CheckCheck size={14} className="text-[#53bdeb]" />;
  if (status === "delivered") return <CheckCheck size={14} />;
  if (status === "sent") return <Check size={14} />;
  if (status === "failed" || status === "undelivered") return <TriangleAlert size={12} className="text-danger" />;
  if (status === "demo") return <span title="Demo mode — not actually sent"><Check size={14} /></span>;
  if (status === "sending") return <Loader2 size={11} className="animate-spin" />;
  return <Clock size={11} />;
}

function MediaView({ url, type }: { url: string; type: string }) {
  // Twilio media needs our account login (proxied); Instagram's are signed public links.
  const src = url.startsWith("https://api.twilio.com/") || url.startsWith("meta-media:") ? `/api/whatsapp/media?url=${encodeURIComponent(url)}` : url;
  // eslint-disable-next-line @next/next/no-img-element
  if (type.startsWith("image/")) return <img src={src} alt="" loading="lazy" className="mb-1 max-h-72 rounded-lg" />;
  if (type.startsWith("audio/")) return <audio controls preload="none" src={src} className="mb-1 max-w-full" />;
  if (type.startsWith("video/")) return <video controls preload="none" src={src} className="mb-1 max-h-72 rounded-lg" />;
  return <a href={src} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 text-sm underline"><FileText size={14} /> Attachment ({type || "file"})</a>;
}

function LeadPanel({ conv, onClose, onSave, flash, onChanged }: {
  conv: Conv; onClose: () => void; onSave: (p: Partial<Conversation>) => Promise<void>; flash: (m: string) => void; onChanged: () => void;
}) {
  const [name, setName] = useState(conv.name);
  const [notes, setNotes] = useState(conv.notes);
  const [tag, setTag] = useState("");
  const [scoring, setScoring] = useState(false);
  const lead = conv.lead;
  const agentName = useAgentName();

  const rescore = async () => {
    setScoring(true);
    try { await api<Lead>(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}/analyze`, { method: "POST" }); onChanged(); }
    catch (e) { flash((e as Error).message); }
    setScoring(false);
  };
  const setStage = (stage: Lead["stage"]) => {
    onSave({ lead: { ...(lead as Lead), stage }, ...(stage === "won" || stage === "lost" ? { status: "resolved" as const } : {}) });
  };

  return (
    <aside className="anim-rise fixed inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l border-line bg-panel shadow-xl lg:static lg:shadow-none">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Target size={15} className="text-brand" /> Lead</h3>
        <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close"><X size={18} /></button>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
        {lead ? (
          <>
            <div className="flex items-center gap-4">
              <ScoreRing score={lead.score} size={64} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{lead.intent || "Lead"}</div>
                <div className="flex items-center gap-1.5 text-xs text-ink-3">
                  {lead.priority && <PriorityBadge priority={lead.priority} />}
                  {lead.source === "gemini" ? "Gemini" : lead.source === "ai" ? "Older AI" : "Rules"} · {timeAgo(lead.analyzedAt)}
                </div>
                <button onClick={rescore} disabled={scoring} className="mt-1 flex items-center gap-1 text-xs font-medium text-brand disabled:opacity-50">
                  {scoring ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Re-score
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">Stage {lead.stageLocked && <span className="font-normal text-ink-3">· set by you</span>}</div>
              <div className="grid grid-cols-5 gap-1 rounded-xl bg-panel-2 p-1">
                {LEAD_STAGES.map((s) => (
                  <button key={s} onClick={() => setStage(s)}
                    className={`flex h-7 items-center justify-center gap-1 rounded-lg text-[11px] font-semibold transition ${lead.stage === s ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-3 hover:text-ink"}`}>
                    {lead.stage === s && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_META[s].dot}`} />}
                    {STAGE_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            {lead.summary && <p className="leading-relaxed text-ink-2">{lead.summary}</p>}

            {(lead.urgency || lead.sentiment || lead.category || lead.language) && (
              <div className="flex flex-wrap gap-1.5 text-[11px] font-medium">
                {lead.category && <span className="rounded-full bg-panel-2 px-2 py-0.5 capitalize text-ink-2">{lead.category}</span>}
                {lead.urgency && <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 capitalize ${lead.urgency === "high" ? "bg-danger-soft text-danger" : lead.urgency === "medium" ? "bg-warn-soft text-warn" : "bg-panel-2 text-ink-2"}`}><Timer size={11} />{lead.urgency} urgency</span>}
                {lead.sentiment && <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 capitalize ${lead.sentiment === "negative" ? "bg-danger-soft text-danger" : lead.sentiment === "positive" ? "bg-ok-soft text-ok" : "bg-panel-2 text-ink-2"}`}><Smile size={11} />{lead.sentiment}</span>}
                {lead.language && <span className="flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-ink-2"><Globe size={11} />{lead.language}</span>}
              </div>
            )}

            {lead.reasons && lead.reasons.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-ink-2">Why this score</div>
                <ul className="space-y-1">
                  {lead.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[13px] leading-snug">
                      {r.impact === "positive" ? <PlusCircle size={14} className="mt-px shrink-0 text-ok" /> : <MinusCircle size={14} className="mt-px shrink-0 text-danger" />}
                      <span className="text-ink-2">{r.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {lead.aiTags && lead.aiTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {lead.aiTags.map((t) => <span key={t} className="rounded-full bg-ai-soft px-2 py-0.5 text-[11px] font-medium text-ai">#{t}</span>)}
              </div>
            )}

            {lead.nextStep && (
              <div className="rounded-xl border border-brand/25 bg-brand-soft px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-brand">Next step</div>
                <div className="mt-0.5 font-medium">{lead.nextStep}</div>
              </div>
            )}

            <dl className="space-y-2">
              <Fact icon={Mail} k="Email" v={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <Fact icon={Building2} k="Company" v={lead.company} />
              <Fact icon={Wallet} k="Budget" v={lead.budget} />
              <Fact icon={Target} k="Interest" v={lead.interest} />
            </dl>
          </>
        ) : (
          <div className="rounded-xl bg-panel-2 px-4 py-5 text-center">
            <p className="text-ink-2">This chat hasn&apos;t been scored yet.</p>
            <button onClick={rescore} disabled={scoring} className="btn btn-primary mt-3 text-xs">
              {scoring ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Score this lead
            </button>
          </div>
        )}

        <div className="h-px bg-line" />

        <Field label="Display name">
          <input className="input" value={name} placeholder={conv.profileName || "Add a name"} onChange={(e) => setName(e.target.value)} onBlur={() => name !== conv.name && onSave({ name })} />
        </Field>
        <Field label="Tags">
          {conv.tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {conv.tags.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-xs">
                  {t}<button onClick={() => onSave({ tags: conv.tags.filter((x) => x !== t) })} className="text-ink-3" aria-label={`Remove ${t}`}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <input className="input" value={tag} placeholder="Add tag + Enter" onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && tag.trim()) { onSave({ tags: [...new Set([...conv.tags, tag.trim()])] }); setTag(""); } }} />
        </Field>
        <Field label="Pinned note">
          <textarea className="input min-h-24" value={notes} placeholder="Key facts about this person (only your team sees this)" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== conv.notes && onSave({ notes })} />
        </Field>
        <dl className="space-y-2 text-xs">
          <Row k="WhatsApp profile" v={conv.profileName || "—"} />
          <Row k="First contact" v={new Date(conv.createdAt).toLocaleString()} />
          <Row k="Last customer message" v={conv.lastInboundAt ? new Date(conv.lastInboundAt).toLocaleString() : "—"} />
          <Row k="24h window" v={conv.sessionOpen ? "Open" : "Closed"} />
        </dl>
      </div>
    </aside>
  );
}

// One-tap tweaks for "add" mode.
const INSTRUCTION_PRESETS = [
  "Keep it short and formal.",
  "Reply in Arabic.",
  "Push gently for a call this week.",
  "Don't discuss prices; say a teammate will send a quote.",
  "They're a VIP: be extra warm and personal.",
  "Don't follow up unless they reply.",
];

// Starting points for "replace" mode: a whole different job for this person.
const BRIEF_TEMPLATES: { label: string; text: string }[] = [
  {
    label: "DevMate client: pitch Sixty",
    text: `This person is a DevMate Solutions lead, not an AI Founder Hub student. Introduce yourself as Freya from DevMate Solutions.
Your goal: show them how Sixty can help their business, then book a free demo.
About Sixty (sixty.devmatesolutions.com): an AI sales agent for WhatsApp and phone that answers every lead in under 60 seconds, day or night. It replies like their best rep, qualifies the lead, books the next step (viewing, table, consultation) and updates their CRM. Official WhatsApp Business API, English, Arabic and 40+ languages, done-for-you setup, live in 7 days.
Pricing: WhatsApp AI Agent from AED 549 a month (Starter), Growth AED 1,099, Scale AED 2,199; AI Call Agent is custom-quoted. Only quote these if they ask.
First find out what business they run and how they handle leads today (who replies, how fast, after hours). Connect Sixty to that, then offer the free demo at https://sixty.devmatesolutions.com
Do not mention AI Founder Hub, the masterclass or the AAA Accelerator.`,
  },
  {
    label: "Existing member: support only",
    text: `This person is already a customer. Do not sell or pitch anything.
Help with their questions warmly and briefly. For anything about their account, payments, access or a complaint, say you'll pass it to the team right away and hand off.`,
  },
  {
    label: "Partner / collaboration",
    text: `This person is a potential partner or collaborator, not a customer. Do not pitch our programs.
Be friendly and professional, learn what they have in mind (their company, the idea, timeline), then say a founder will follow up personally and hand off.`,
  },
];

/** A custom brief for the agent, for this one person: added to the usual instructions, or replacing them. */
function AgentInstructions({ conv, agentName, onSave }: { conv: Conv; agentName: string; onSave: (p: Partial<Conversation>) => Promise<void> }) {
  const saved = conv.aiInstructions ?? "";
  const savedMode = conv.aiInstructionsMode ?? "add";
  const [text, setText] = useState(saved);
  // New briefs default to "replace": a different job for this person is the usual reason to write one.
  const [mode, setMode] = useState<"add" | "replace">(saved ? savedMode : "replace");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const dirty = text.trim() !== saved.trim() || (Boolean(text.trim()) && mode !== savedMode);
  const who = displayName(conv).split(" ")[0];
  const replace = mode === "replace";

  const save = async (value = text) => {
    setBusy(true);
    await onSave({ aiInstructions: value.trim(), aiInstructionsMode: mode });
    setBusy(false); setDone(true); setTimeout(() => setDone(false), 1800);
  };

  return (
    <section className={`rounded-2xl border p-3.5 ${saved ? "border-ai/40 bg-ai-soft/60" : "border-line bg-panel-2/50"}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ai text-[11px] font-bold text-white">{agentName.slice(0, 1).toUpperCase()}</span>
        <span className="text-xs font-semibold leading-tight">{agentName}&apos;s brief for {who}</span>
        {saved && !dirty && <span className="ml-auto rounded-full bg-ai px-2 py-0.5 text-[10px] font-semibold text-white">{savedMode === "replace" ? "Own brief" : "Active"}</span>}
      </div>

      <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-panel p-1 text-[11.5px] font-medium">
        {([["replace", "Own brief"], ["add", "Add to usual"]] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`h-7 rounded-lg transition ${mode === m ? "bg-ai text-white shadow-sm" : "text-ink-2 hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-ink-3">
        {replace
          ? `${agentName} ignores the usual script for ${who} and works only from this brief: who she represents, what to offer and how to talk.`
          : `${agentName} keeps her usual instructions and also follows this for ${who}.`}
      </p>

      <textarea className={`input bg-panel text-[13px] ${replace ? "min-h-[120px]" : "min-h-[72px]"}`} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={replace
          ? `e.g. "${who} is a DevMate Solutions client. Introduce yourself as Freya from DevMate and show how Sixty answers their leads in 60 seconds. Offer a free demo."`
          : `e.g. "Keep replies under 2 lines and mention the early-bird discount."`} />

      <div className="mt-2 flex flex-wrap gap-1">
        {replace
          ? BRIEF_TEMPLATES.map((t) => (
              <button key={t.label} type="button" onClick={() => setText(t.text)}
                className="rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] text-ink-2 hover:border-ai hover:text-ai">Use: {t.label}</button>
            ))
          : INSTRUCTION_PRESETS.filter((p) => !text.includes(p)).slice(0, 4).map((p) => (
              <button key={p} type="button" onClick={() => setText((t) => (t.trim() ? `${t.trim()}\n${p}` : p))}
                className="rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] text-ink-2 hover:border-ai hover:text-ai">+ {p}</button>
            ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-[11px] leading-tight text-ink-3">{conv.aiEnabled ? `Used from ${agentName}'s next reply, and in ✨ drafts.` : `${agentName} is off for this chat; used in ✨ drafts and when you hand back.`}</span>
        {saved && <button type="button" disabled={busy} onClick={() => { setText(""); void save(""); }} className="ml-auto text-[11px] text-ink-3 hover:text-danger">Clear</button>}
        <button type="button" disabled={busy || !dirty} onClick={() => save()} className={`btn h-7 px-3 text-xs ${saved ? "" : "ml-auto"} ${dirty ? "btn-primary" : ""}`}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : done ? <Check size={12} /> : null}{done ? "Saved" : "Save"}
        </button>
      </div>
    </section>
  );
}

function Fact({ icon: Icon, k, v, href }: { icon: React.ComponentType<{ size?: number; className?: string }>; k: string; v: string; href?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={14} className="shrink-0 text-ink-3" />
      <dt className="w-16 shrink-0 text-xs text-ink-3">{k}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium">
        {v ? href ? <a href={href} className="hover:text-brand">{v}</a> : v : <span className="font-normal text-ink-3">—</span>}
      </dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1.5 text-xs font-medium text-ink-2">{label}</div>{children}</div>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-3">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;
}

function groupByDay(messages: Message[], notes: Note[] = []): [string, (Message | Note)[]][] {
  const out = new Map<string, (Message | Note)[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const items = [...messages, ...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const m of items) {
    const d = new Date(m.createdAt);
    const key = d.toDateString() === today ? "Today" : d.toDateString() === yesterday ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(m);
  }
  return [...out];
}

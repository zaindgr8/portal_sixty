"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Building2, Check, CheckCircle2, Clock, Copy, Link2, Loader2, MessageCircle, PauseCircle, PhoneCall, Plus, Search, ShieldCheck, Users, X,
} from "lucide-react";
import { api } from "@/lib/whatsapp/client";
import type { Invite, WorkspaceInfo, WorkspaceStatus, WorkspaceSummary } from "@/lib/tenant/types";
import { PLANS } from "@/lib/tenant/types";
import type { ModuleKey } from "@/lib/auth/modules";

type Detail = {
  workspace: WorkspaceInfo;
  users: { username: string; display_name: string; email: string | null; role: string; modules: string[]; active: boolean; last_login_at: string | null }[];
  invites: Invite[];
};

const STATUS: Record<WorkspaceStatus, { label: string; cls: string }> = {
  pending: { label: "Waiting for approval", cls: "bg-warn-soft text-warn" },
  active: { label: "Active", cls: "bg-ok-soft text-ok" },
  suspended: { label: "Suspended", cls: "bg-panel-2 text-ink-3" },
};
const MODULE_LABEL: Record<ModuleKey, string> = { whatsapp: "WhatsApp", calls: "Voice" };

const ago = (iso?: string) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

async function openWorkspace(id: string) {
  await api("/api/admin/switch", { method: "POST", json: { workspaceId: id } });
  window.location.href = "/";
}

export default function AdminPage() {
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"all" | WorkspaceStatus>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => api<WorkspaceSummary[]>("/api/admin/workspaces").then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: 0, pending: 0, active: 0, suspended: 0 };
    for (const w of list ?? []) { c.all++; c[w.status]++; }
    return c;
  }, [list]);

  const shown = useMemo(() => {
    const s = query.trim().toLowerCase();
    return (list ?? [])
      .filter((w) => tab === "all" || w.status === tab)
      .filter((w) => !s || `${w.name} ${w.id} ${w.contactName} ${w.contactEmail}`.toLowerCase().includes(s))
      // Pending first: they're waiting on you.
      .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || a.name.localeCompare(b.name));
  }, [list, tab, query]);

  const setStatus = async (id: string, status: WorkspaceStatus) => {
    try {
      await api(`/api/admin/workspaces/${encodeURIComponent(id)}`, { method: "PATCH", json: { status } });
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  if (!list) {
    return <div className="grid h-full place-items-center text-ink-3">{error ? <p className="text-sm text-danger">{error}</p> : <Loader2 className="animate-spin" />}</div>;
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><ShieldCheck size={22} className="text-brand" />Admin console</h1>
            <p className="text-sm text-ink-2">Every client workspace: approve sign-ups, onboard new clients and jump into any account.</p>
          </div>
          <button onClick={() => setCreating(true)} className="btn btn-primary ml-auto"><Plus size={16} /> Onboard client</button>
        </div>

        {error && <div className="mb-4 flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"><span className="flex-1">{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            ["Workspaces", counts.all, Building2, "text-brand"],
            ["Waiting for approval", counts.pending, Clock, "text-warn"],
            ["Active", counts.active, CheckCircle2, "text-ok"],
            ["Suspended", counts.suspended, PauseCircle, "text-ink-3"],
          ] as const).map(([label, n, Icon, cls]) => (
            <div key={label} className="card flex items-center gap-3 px-4 py-3.5">
              <span className={`grid h-9 w-9 place-items-center rounded-xl bg-panel-2 ${cls}`}><Icon size={18} /></span>
              <span className="leading-tight"><span className="block text-xl font-semibold">{n}</span><span className="text-xs text-ink-2">{label}</span></span>
            </div>
          ))}
        </div>

        <section className="card overflow-hidden">
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <div className="flex rounded-xl bg-panel-2 p-1">
              {(["all", "pending", "active", "suspended"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium capitalize ${tab === t ? "bg-panel shadow-sm" : "text-ink-2 hover:text-ink"}`}>
                  {t}<span className={`rounded-md px-1.5 text-[11px] ${tab === t ? "bg-brand text-white" : "bg-panel text-ink-3"}`}>{counts[t]}</span>
                </button>
              ))}
            </div>
            <label className="relative ml-auto w-full max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input className="input pl-9" placeholder="Search clients…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Modules</th>
                  <th className="px-3 py-2.5 font-medium">Connected</th>
                  <th className="px-3 py-2.5 font-medium">Setup</th>
                  <th className="px-3 py-2.5 text-right font-medium">People</th>
                  <th className="px-3 py-2.5 text-right font-medium">Chats</th>
                  <th className="px-3 py-2.5 font-medium">Last activity</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((w) => (
                  <tr key={w.id} onClick={() => setOpen(w.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-panel-2/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 font-semibold text-brand">{w.name.slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0 leading-tight">
                          <span className="flex items-center gap-1.5 font-medium">{w.name}{w.isPrimary && <span className="rounded-md bg-info-soft px-1.5 text-[10px] font-semibold text-info">PRIMARY</span>}</span>
                          <span className="block truncate text-xs text-ink-3">{w.contactEmail || w.id} · <span className="capitalize">{w.plan}</span></span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3"><span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${STATUS[w.status].cls}`}>{STATUS[w.status].label}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">{w.modules.map((m) => <span key={m} className="inline-flex h-6 items-center rounded-md bg-panel-2 px-2 text-xs">{MODULE_LABEL[m]}</span>)}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2 text-ink-3">
                        {w.modules.includes("whatsapp") && <span title={w.connected.whatsapp ? "WhatsApp connected" : "WhatsApp not connected"} className={w.connected.whatsapp ? "text-ok" : ""}><MessageCircle size={16} /></span>}
                        {w.modules.includes("calls") && <span title={w.connected.calls ? "Voice connected" : "Voice not connected"} className={w.connected.calls ? "text-ok" : ""}><PhoneCall size={16} /></span>}
                      </div>
                    </td>
                    <td className="px-3 py-3"><SetupDots steps={w.setup} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">{w.users}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{w.conversations}</td>
                    <td className="px-3 py-3 text-ink-2">{ago(w.lastActivityAt)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        {w.status === "pending" && <button onClick={() => setStatus(w.id, "active")} className="btn h-8 border-ok/30 px-3 text-xs text-ok"><Check size={14} />Approve</button>}
                        <button onClick={() => openWorkspace(w.id)} className="btn h-8 px-3 text-xs" title="Open this workspace as its owner">Open<ArrowRight size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-ink-3">No workspaces here.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {open && <WorkspaceDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
      {creating && <OnboardModal onClose={() => setCreating(false)} onCreated={load} />}
    </div>
  );
}

const STEP_LABEL: Record<string, string> = { account: "Account", whatsapp: "WhatsApp", instagram: "Instagram", business: "Business info", team: "Team", agent: "Agent live" };

/** Each onboarding step as a dot: green done, grey to do (optional steps are hollow). */
function SetupDots({ steps }: { steps: WorkspaceSummary["setup"] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <span className="flex items-center gap-1.5" title={steps.map((s) => `${s.done ? "✓" : "·"} ${STEP_LABEL[s.key]}${s.optional ? " (optional)" : ""}`).join("\n")}>
      {steps.map((s) => (
        <span key={s.key} className={`h-2.5 w-2.5 rounded-full ${s.done ? "bg-ok" : s.optional ? "border border-line" : "bg-line"}`} />
      ))}
      <span className="ml-1 text-xs tabular-nums text-ink-3">{done}/{steps.length}</span>
    </span>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 p-1.5 pl-3">
      <Link2 size={14} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span>
      <button type="button" className="btn h-8 px-3 text-xs" onClick={() => { void navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        {copied ? <><Check size={13} />Copied</> : <><Copy size={13} />Copy</>}
      </button>
    </div>
  );
}

function ModulePicker({ value, onChange }: { value: ModuleKey[]; onChange: (m: ModuleKey[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["whatsapp", "calls"] as ModuleKey[]).map((m) => {
        const on = value.includes(m);
        const Icon = m === "whatsapp" ? MessageCircle : PhoneCall;
        return (
          <button type="button" key={m} onClick={() => onChange(on ? value.filter((x) => x !== m) : [...value, m])}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium ${on ? "border-brand bg-brand/5" : "border-line text-ink-2"}`}>
            <Icon size={16} className={on ? "text-brand" : "text-ink-3"} />{MODULE_LABEL[m]}
            {on && <Check size={14} className="ml-auto text-brand" />}
          </button>
        );
      })}
    </div>
  );
}

function OnboardModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: "", contactName: "", contactEmail: "", plan: "starter", modules: ["whatsapp"] as ModuleKey[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ link: string; id: string; name: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await api<{ workspace: WorkspaceInfo; link: string }>("/api/admin/workspaces", { method: "POST", json: f });
      setDone({ link: r.link, id: r.workspace.id, name: r.workspace.name });
      onCreated();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  return (
    <div data-modal className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="card anim-pop w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{done ? `${done.name} is ready` : "Onboard a client"}</h3>
          <button type="button" onClick={onClose} className="text-ink-3"><X size={18} /></button>
        </div>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">Send this link to the client&apos;s owner. They choose their own username and password, then land in their workspace. It works once and expires in 7 days.</p>
            <CopyLink link={done.link} />
            <div className="rounded-xl bg-panel-2 p-4 text-sm">
              <p className="mb-2 font-medium">Next steps</p>
              <ol className="list-decimal space-y-1 pl-5 text-ink-2">
                <li>Open the workspace and add its Twilio / Retell keys (Workspace settings → Connections), or let the client do it.</li>
                <li>Set the AI agent&apos;s persona and knowledge (WhatsApp → AI agent).</li>
                <li>Point the client&apos;s Twilio number at the webhook shown on the Connections page.</li>
              </ol>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={onClose}>Done</button>
              <button className="btn btn-primary" onClick={() => openWorkspace(done.id)}>Open workspace <ArrowRight size={15} /></button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3.5">
            <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">Company or brand</span>
              <input className="input" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Acme Realty" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">Owner&apos;s name</span>
                <input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">Owner&apos;s email</span>
                <input className="input" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></label>
            </div>
            <div><span className="mb-1 block text-xs font-medium text-ink-2">Modules</span><ModulePicker value={f.modules} onChange={(modules) => setF({ ...f, modules })} /></div>
            <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">Plan</span>
              <select className="input capitalize" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>{PLANS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            {err && <p className="text-sm text-danger">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn">Cancel</button>
              <button className="btn btn-primary" disabled={busy || !f.modules.length}>{busy && <Loader2 size={15} className="animate-spin" />}Create &amp; get invite link</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function WorkspaceDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Detail>(`/api/admin/workspaces/${encodeURIComponent(id)}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const patch = async (p: Record<string, unknown>) => {
    setErr("");
    try {
      const r = await api<{ workspace: WorkspaceInfo }>(`/api/admin/workspaces/${encodeURIComponent(id)}`, { method: "PATCH", json: p });
      setD((x) => (x ? { ...x, workspace: r.workspace } : x));
      onChanged();
    } catch (e) { setErr((e as Error).message); }
  };
  const newInvite = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ link: string }>(`/api/admin/workspaces/${encodeURIComponent(id)}/invites`, { method: "POST", json: { role: "owner", email: d?.workspace.contactEmail, name: d?.workspace.contactName } });
      setLink(r.link);
      load();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const w = d?.workspace;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="anim-rise scroll-thin h-full w-full max-w-md overflow-y-auto bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {!w ? <div className="grid h-full place-items-center text-ink-3">{err ? <p className="px-6 text-sm text-danger">{err}</p> : <Loader2 className="animate-spin" />}</div> : (
          <div className="p-6">
            <div className="mb-5 flex items-start gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-lg font-semibold text-brand">{w.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold">{w.name}</h3>
                <p className="text-xs text-ink-3">{w.id} · created {new Date(w.createdAt).toLocaleDateString()}</p>
              </div>
              <button onClick={onClose} className="text-ink-3"><X size={18} /></button>
            </div>

            {err && <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}

            <div className="mb-5 flex flex-wrap gap-2">
              {w.status === "pending" && <button className="btn btn-primary" onClick={() => patch({ status: "active" })}><Check size={15} />Approve</button>}
              {w.status === "active" && !w.isPrimary && <button className="btn" onClick={() => patch({ status: "suspended" })}><PauseCircle size={15} />Suspend</button>}
              {w.status === "suspended" && <button className="btn" onClick={() => patch({ status: "active" })}><CheckCircle2 size={15} />Reactivate</button>}
              <button className="btn" onClick={() => openWorkspace(w.id)}>Open workspace<ArrowRight size={14} /></button>
            </div>

            <dl className="mb-5 grid grid-cols-[110px_1fr] gap-y-2 text-sm">
              <dt className="text-ink-3">Status</dt><dd><span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${STATUS[w.status].cls}`}>{STATUS[w.status].label}</span></dd>
              <dt className="text-ink-3">Owner</dt><dd>{w.contactName || "—"}{w.contactEmail && <span className="block text-xs text-ink-3">{w.contactEmail}</span>}</dd>
              {w.approvedAt && <><dt className="text-ink-3">Approved</dt><dd>{new Date(w.approvedAt).toLocaleDateString()}{w.approvedBy ? ` by ${w.approvedBy}` : ""}</dd></>}
            </dl>

            <div className="mb-4"><span className="mb-1.5 block text-xs font-medium text-ink-2">Modules</span>
              <ModulePicker value={w.modules} onChange={(modules) => modules.length && patch({ modules })} /></div>
            <div className="mb-4"><span className="mb-1.5 block text-xs font-medium text-ink-2">Features</span>
              <button type="button" onClick={() => patch({ features: w.features.includes("proptech_auto_listing") ? w.features.filter((f) => f !== "proptech_auto_listing") : [...w.features, "proptech_auto_listing"] })}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium ${w.features.includes("proptech_auto_listing") ? "border-brand bg-brand/5" : "border-line text-ink-2"}`}>
                <Building2 size={16} className={w.features.includes("proptech_auto_listing") ? "text-brand" : "text-ink-3"} />PropTech · Auto Listing
                {w.features.includes("proptech_auto_listing") && <Check size={14} className="ml-auto text-brand" />}
              </button></div>
            <label className="mb-4 block"><span className="mb-1.5 block text-xs font-medium text-ink-2">Plan</span>
              <select className="input capitalize" value={w.plan} onChange={(e) => patch({ plan: e.target.value })}>{PLANS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            <label className="mb-6 block"><span className="mb-1.5 block text-xs font-medium text-ink-2">Internal notes (only platform admins see these)</span>
              <textarea className="input min-h-[72px]" defaultValue={w.notes} onBlur={(e) => e.target.value !== w.notes && patch({ notes: e.target.value })} /></label>

            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Users size={15} className="text-brand" />People <span className="font-normal text-ink-3">{d.users.length}</span></h4>
            <ul className="mb-5 divide-y divide-line rounded-xl border border-line">
              {d.users.map((u) => (
                <li key={u.username} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${u.active ? "" : "opacity-50"}`}>
                  <span className="min-w-0 flex-1 leading-tight"><span className="block truncate font-medium">{u.display_name || u.username}</span><span className="block truncate text-xs text-ink-3">{u.username}{u.email ? ` · ${u.email}` : ""}</span></span>
                  <span className="rounded-md bg-panel-2 px-2 py-0.5 text-xs capitalize">{u.role}</span>
                </li>
              ))}
              {!d.users.length && <li className="px-3 py-4 text-center text-xs text-ink-3">Nobody has joined yet.</li>}
            </ul>

            <h4 className="mb-2 text-sm font-semibold">Invite links</h4>
            {d.invites.length > 0 && (
              <ul className="mb-3 space-y-1.5 text-xs text-ink-2">
                {d.invites.map((i) => <li key={i.id} className="flex justify-between rounded-lg bg-panel-2 px-3 py-2"><span>{i.email || i.name || "Open invite"} · <span className="capitalize">{i.role}</span></span><span className="text-ink-3">expires {new Date(i.expiresAt).toLocaleDateString()}</span></li>)}
              </ul>
            )}
            {link ? <CopyLink link={link} /> : (
              <button className="btn w-full" onClick={newInvite} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}New owner invite link</button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

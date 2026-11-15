'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileSignature, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, ErrorBar } from '@/components/proptech/ui';
import { STAGE_LABEL, WARN_DAYS, type Compliance, type Stage } from '@/lib/proptech/compliance';
import { PORTAL_LABEL } from '@/lib/proptech/types';

type Item = { id: string; title: string; place: string; status: string; agentId: string | null; updatedAt: string; compliance: Compliance };
type Summary = { urgent: number; expiringSoon: number; waiting: number; toApply: number; live: number };
type Filter = 'action' | 'all' | Stage;

const STAGE_CLS: Record<Stage, string> = {
  form_a: 'bg-panel-2 text-ink-2', apply: 'bg-info-soft text-info', waiting: 'bg-warn-soft text-warn', ready: 'bg-ok-soft text-ok', live: 'bg-ok-soft text-ok',
};
const fmt = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const left = (n: number | null) => (n === null ? '' : n < 0 ? `expired ${-n}d ago` : n === 0 ? 'expires today' : `${n}d left`);

export default function CompliancePage() {
  const [data, setData] = useState<{ items: Item[]; summary: Summary } | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('action');
  useEffect(() => { api<{ items: Item[]; summary: Summary }>('/api/proptech/compliance').then(setData).catch((e: Error) => setError(e.message)); }, []);

  if (!data) return <div className="grid h-full place-items-center text-ink-3">{error ? <p className="px-6 text-sm text-danger">{error}</p> : <Loader2 className="animate-spin" />}</div>;
  const s = data.summary;
  const shown = data.items.filter((i) => filter === 'all' || (filter === 'action' ? i.compliance.level !== 'ok' : i.compliance.stage === filter));
  const cards: { key: Filter; n: number; label: string; icon: typeof ShieldAlert; cls: string }[] = [
    { key: 'action', n: data.items.filter((i) => i.compliance.level !== 'ok').length, label: 'Need attention', icon: ShieldAlert, cls: s.urgent ? 'text-bad' : 'text-warn' },
    { key: 'apply', n: s.toApply, label: 'To apply for a permit', icon: FileSignature, cls: 'text-info' },
    { key: 'waiting', n: s.waiting, label: 'Waiting for the permit', icon: Clock, cls: 'text-warn' },
    { key: 'live', n: s.live, label: 'Live with a valid permit', icon: ShieldCheck, cls: 'text-ok' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
      <p className="mb-5 text-sm text-ink-2">Form A, then the Trakheesi permit, then the portals. A listing advertised without a valid permit is removed by the portals and fined by DLD, so Sixty warns you {WARN_DAYS} days before a permit or Form A runs out, and takes expired listings off the portals it posts to.</p>
      <ErrorBar error={error} onClose={() => setError('')} />

      {s.urgent > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span><b>{s.urgent} listing{s.urgent > 1 ? 's' : ''} need{s.urgent > 1 ? '' : 's'} action now</b>: a permit or Form A has run out, or is about to, while the listing is on a portal.</span>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4">
        {cards.map((c) => (
          <button key={c.key} onClick={() => setFilter(filter === c.key ? 'all' : c.key)} className={`card p-3 text-left transition ${filter === c.key ? 'ring-2 ring-brand' : ''}`}>
            <c.icon size={18} className={c.cls} />
            <p className="mt-1 text-2xl font-semibold tabular-nums">{c.n}</p>
            <p className="text-xs text-ink-3">{c.label}</p>
          </button>
        ))}
      </div>
      {s.expiringSoon > 0 && <p className="mb-3 text-sm text-warn">{s.expiringSoon} permit{s.expiringSoon > 1 ? 's or Form As expire' : ' or Form A expires'} within {WARN_DAYS} days.</p>}

      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-ink-3">Showing</span>
        <select className="input w-auto py-1" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter">
          <option value="action">Need attention</option>
          <option value="all">All listings</option>
          {(Object.keys(STAGE_LABEL) as Stage[]).map((k) => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="card flex items-center gap-2 p-6 text-sm text-ink-2"><CheckCircle2 size={16} className="text-ok" />Nothing here. {filter === 'action' ? 'Every listing is in order.' : ''}</div>
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => {
            const c = i.compliance;
            return (
              <li key={i.id}>
                <Link href={`/proptech/listings/${i.id}`} className={`card block p-3 hover:border-brand ${c.level === 'bad' ? 'border-bad/50' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${STAGE_CLS[c.stage]}`}>{STAGE_LABEL[c.stage]}</span>
                    <b className="min-w-0 flex-1 truncate text-sm">{i.title}</b>
                    {c.live.length > 0 && <span className="text-xs text-ok">On {c.live.map((p) => PORTAL_LABEL[p]).join(', ')}</span>}
                  </div>
                  <div className="mt-1.5 grid gap-1 text-xs text-ink-2 sm:grid-cols-3">
                    <span className="truncate">{i.place || '—'}</span>
                    <span>Form A: {c.formA.state === 'missing' ? 'not uploaded' : <>{fmt(c.formA.expiry)} {c.formA.expiry && <span className={c.formA.state === 'expired' ? 'text-bad' : c.formA.state === 'expiring' ? 'text-warn' : 'text-ink-3'}>({left(c.formA.daysLeft)})</span>}</>}</span>
                    <span>Permit: {c.permit.number ? <>{c.permit.number} · {fmt(c.permit.expiry)} {c.permit.expiry && <span className={c.permit.state === 'expired' ? 'text-bad' : c.permit.state === 'expiring' ? 'text-warn' : 'text-ink-3'}>({left(c.permit.daysLeft)})</span>}</> : c.permit.state === 'applied' ? `applied ${c.permit.waitingDays ?? 0}d ago` : 'not applied'}</span>
                  </div>
                  {c.alerts.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {c.alerts.map((a, k) => <li key={k} className={`flex gap-1.5 text-xs ${a.level === 'bad' ? 'text-bad' : 'text-warn'}`}><AlertTriangle size={12} className="mt-0.5 shrink-0" />{a.text}</li>)}
                    </ul>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

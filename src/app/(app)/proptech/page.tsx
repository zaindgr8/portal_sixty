'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Building2, ImageOff, Loader2, Plus } from 'lucide-react';
import { api, ErrorBar, PortalChip, StatusChip, ago } from '@/components/proptech/ui';
import { LISTING_STATUSES, PORTAL_LABEL, PORTALS, PROPERTY_TYPE_LABEL, fmtAed, type ListingSummary } from '@/lib/proptech/types';

type Agent = { username: string; name: string };

export default function AutoListingPage() {
  const [rows, setRows] = useState<ListingSummary[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [f, setF] = useState({ status: '', portal: '', agent: '' });
  const [error, setError] = useState('');

  useEffect(() => { api<{ agents: Agent[] }>('/api/proptech/agents').then((r) => setAgents(r.agents)).catch(() => {}); }, []);
  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<{ listings: ListingSummary[] }>(`/api/proptech/listings${qs ? `?${qs}` : ''}`).then((r) => setRows(r.listings)).catch((e: Error) => setError(e.message));
  }, [f]);

  const name = (u: string | null) => agents.find((a) => a.username === u)?.name ?? u ?? '—';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Auto Listing</h1>
          <p className="text-sm text-ink-2">Form A and photos in, portal-ready listings out.</p>
        </div>
        <Link href="/proptech/new" className="btn btn-primary"><Plus size={16} />New listing</Link>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Filter by status">
          <option value="">All statuses</option>
          {LISTING_STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
        <select className="input" value={f.portal} onChange={(e) => setF({ ...f, portal: e.target.value })} aria-label="Filter by portal">
          <option value="">All portals</option>
          {PORTALS.map((p) => <option key={p} value={p}>{PORTAL_LABEL[p]}</option>)}
        </select>
        <select className="input" value={f.agent} onChange={(e) => setF({ ...f, agent: e.target.value })} aria-label="Filter by agent">
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.username} value={a.username}>{a.name}</option>)}
        </select>
      </div>

      <ErrorBar error={error} onClose={() => setError('')} />

      {!rows ? <div className="grid h-40 place-items-center text-ink-3"><Loader2 className="animate-spin" /></div> : !rows.length ? (
        <div className="card grid place-items-center px-6 py-14 text-center">
          <Building2 className="mb-3 text-ink-3" size={30} />
          <p className="font-semibold">{Object.values(f).some(Boolean) ? 'No listings match these filters' : 'No listings yet'}</p>
          <p className="mt-1 max-w-sm text-sm text-ink-2">Upload a Form A and a few photos. The AI fills in the details and writes the English and Arabic copy for you to check.</p>
          <Link href="/proptech/new" className="btn btn-primary mt-4"><Plus size={16} />Create your first listing</Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((l) => (
            <li key={l.id}>
              <Link href={`/proptech/listings/${l.id}`} className="card block overflow-hidden transition hover:ring-1 hover:ring-brand/30">
                <div className="relative aspect-[16/10] bg-panel-2">
                  {l.coverUrl
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                    ? <img src={l.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    : <div className="grid h-full place-items-center text-ink-3"><ImageOff size={22} /></div>}
                  <span className="absolute left-2 top-2"><StatusChip status={l.status} /></span>
                </div>
                <div className="p-3.5">
                  <p className="truncate font-semibold">{l.title}</p>
                  <p className="truncate text-sm text-ink-2">
                    {[l.propertyType ? PROPERTY_TYPE_LABEL[l.propertyType] ?? l.propertyType : null, l.community].filter(Boolean).join(' · ') || 'Details pending'}
                  </p>
                  <p className="mt-1 text-sm font-medium">{fmtAed(l.price)}{l.priceType === 'yearly' ? ' / year' : l.priceType === 'monthly' ? ' / month' : ''}</p>
                  {l.portals.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{l.portals.map((p) => <PortalChip key={p.portal} portal={p.portal} status={p.status} short />)}</div>}
                  <p className="mt-2 text-xs text-ink-3">{name(l.agentId)} · updated {ago(l.updatedAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

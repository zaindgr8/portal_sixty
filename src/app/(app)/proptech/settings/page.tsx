'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, KeyRound, Loader2, RefreshCw, Rss, Save, TestTube2, Users } from 'lucide-react';
import { ErrorBar, ago, api } from '@/components/proptech/ui';
import type { PortalConnectionView, PortalDefaults } from '@/lib/proptech/types';

type View = { portals: PortalConnectionView[]; pfMissing: string[] };
type Agent = { username: string; name: string; role: string };

export default function PortalSettingsPage() {
  const [v, setV] = useState<View | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const load = useCallback(() => api<View>('/api/proptech/portals').then(setV).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { load(); api<{ agents: Agent[] }>('/api/proptech/agents').then((r) => setAgents(r.agents)).catch(() => {}); }, [load]);

  const put = async (body: object, msg = 'Saved') => {
    setError('');
    try { await api('/api/proptech/portals', { method: 'PUT', json: body }); setSaved(msg); setTimeout(() => setSaved(''), 2000); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  };

  if (!v) return <div className="grid h-full place-items-center text-ink-3">{error ? <p className="px-6 text-sm text-danger">{error}</p> : <Loader2 className="animate-spin" />}</div>;
  const get = (p: string) => v.portals.find((x) => x.portal === p)!;
  const pf = get('propertyfinder'), bayut = get('bayut'), mock = get('mock');
  // ORN and agent numbers are agency-wide; we keep them on every connection row so each adapter has them.
  const defaults: PortalDefaults = { orn: pf.defaults.orn ?? bayut.defaults.orn ?? mock.defaults.orn, agents: { ...mock.defaults.agents, ...bayut.defaults.agents, ...pf.defaults.agents } };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Portal Settings</h1>
      <p className="mb-5 text-sm text-ink-2">Connect Property Finder and Bayut / dubizzle, and save your agency and agent numbers. Keys are encrypted and never shown again.</p>
      <ErrorBar error={error} onClose={() => setError('')} />
      {saved && <p className="mb-3 flex items-center gap-1.5 text-sm text-ok"><CheckCircle2 size={15} />{saved}</p>}

      <Numbers defaults={defaults} agents={agents} onSave={async (d) => { for (const p of ['propertyfinder', 'bayut', 'mock']) await put({ portal: p, defaults: { ...get(p).defaults, ...d } }, 'Agency numbers saved'); }} />

      <section className="card mb-4 p-4 md:p-5">
        <Head title="Property Finder" sub="Enterprise API 2.0" on={pf.enabled} onToggle={(on) => put({ portal: 'propertyfinder', enabled: on })} />
        <p className="mb-3 text-sm text-ink-2">Your Decision Maker creates an API key and secret in <b>PF Expert → Developer Resources → API Credentials</b> and pastes them here. Start in sandbox.</p>
        <div className="mb-3 flex rounded-lg border border-line p-0.5 text-sm">
          {(['sandbox', 'live'] as const).map((m) => <button key={m} onClick={() => m !== pf.mode && (m === 'sandbox' || confirm('Switch Property Finder to LIVE? Listings will go on the real site.')) && put({ portal: 'propertyfinder', mode: m })} className={`flex-1 rounded-md px-3 py-1.5 capitalize ${pf.mode === m ? 'bg-panel-2 font-semibold' : 'text-ink-2'}`}>{m}</button>)}
        </div>
        <Keys has={pf.hasCredentials} onSave={(apiKey, apiSecret) => put({ portal: 'propertyfinder', apiKey, apiSecret }, 'Property Finder keys saved')} onClear={() => put({ portal: 'propertyfinder', clearCredentials: true }, 'Keys removed')} />
        {v.pfMissing.length > 0 && (
          <div className="mt-3 rounded-xl bg-warn-soft px-3 py-2.5 text-xs text-warn">
            <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} />Property Finder publishing isn&apos;t switched on yet</p>
            <p className="mt-1">We need the details from Property Finder&apos;s API documentation (Developer Resources → API Documentation): {v.pfMissing.join('; ')}. Until then, use the demo portal or Bayut.</p>
          </div>
        )}
      </section>

      <section className="card mb-4 p-4 md:p-5">
        <Head title="Bayut / dubizzle" sub="XML feed" on={bayut.enabled} onToggle={(on) => put({ portal: 'bayut', enabled: on })} />
        <p className="mb-3 text-sm text-ink-2">Bayut and dubizzle read a feed URL you register with them. Only approved listings with a valid permit, marked for Bayut, are in it. It refreshes every 5 minutes.</p>
        {bayut.feedUrl ? (
          <>
            <FeedUrl url={bayut.feedUrl} />
            <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-1 text-sm">
              <dt className="text-ink-3">Last fetched by Bayut</dt><dd>{ago(bayut.lastFetchedAt)}</dd>
              <dt className="text-ink-3">Last generated</dt><dd>{ago(bayut.lastGeneratedAt)}</dd>
            </dl>
            {bayut.lastFeedError && <p className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">The last update failed, so Bayut still sees the previous good feed: {bayut.lastFeedError}</p>}
            <button className="btn mt-3" onClick={() => confirm('Make a new feed URL? The old one stops working, so update it with Bayut.') && put({ portal: 'bayut', rotateFeedToken: true }, 'New feed URL created')}><RefreshCw size={15} />New feed URL</button>
          </>
        ) : <button className="btn btn-primary" onClick={() => put({ portal: 'bayut', enabled: true }, 'Feed created')}><Rss size={15} />Create feed URL</button>}
      </section>

      <section className="card mb-4 p-4 md:p-5">
        <Head title="Demo portal" sub="for testing and client demos" on={mock.enabled} onToggle={(on) => put({ portal: 'mock', enabled: on, defaults: { ...mock.defaults, mock: mock.defaults.mock ?? { rejectFirst: true, delayMs: 800 } } })} />
        <p className="mb-3 text-sm text-ink-2">Pretends to be a portal so you can show the whole flow without portal access: submit, a rejection to fix, then live.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={mock.defaults.mock?.rejectFirst !== false} onChange={(e) => put({ portal: 'mock', defaults: { ...mock.defaults, mock: { delayMs: mock.defaults.mock?.delayMs ?? 800, rejectFirst: e.target.checked } } })} />
          <TestTube2 size={15} className="text-ink-3" />Reject each listing&apos;s first submission (to demo the fix loop)
        </label>
      </section>
    </div>
  );
}

function Head({ title, sub, on, onToggle }: { title: string; sub: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h2 className="font-semibold">{title} <span className="font-normal text-ink-3">· {sub}</span></h2>
      <label className="ml-auto flex items-center gap-2 text-sm">
        <span className={on ? 'text-ok' : 'text-ink-3'}>{on ? 'On' : 'Off'}</span>
        <input type="checkbox" role="switch" className="h-4 w-4 accent-[var(--brand)]" checked={on} onChange={(e) => onToggle(e.target.checked)} aria-label={`${title} on or off`} />
      </label>
    </div>
  );
}

function Keys({ has, onSave, onClear }: { has: boolean; onSave: (k: string, s: string) => void; onClear: () => void }) {
  const [k, setK] = useState('');
  const [s, setS] = useState('');
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm">{has ? <><CheckCircle2 size={15} className="text-ok" />Keys saved</> : <><KeyRound size={15} className="text-ink-3" />No keys saved</>}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder={has ? 'New API key' : 'API key'} value={k} onChange={(e) => setK(e.target.value)} autoComplete="off" />
        <input className="input" type="password" placeholder={has ? 'New API secret' : 'API secret'} value={s} onChange={(e) => setS(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="flex gap-2">
        <button className="btn" disabled={!k || !s} onClick={() => { onSave(k, s); setK(''); setS(''); }}><Save size={15} />Save keys</button>
        {has && <button className="btn btn-ghost" onClick={() => confirm('Remove the saved Property Finder keys?') && onClear()}>Remove keys</button>}
      </div>
    </div>
  );
}

function FeedUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 p-2">
      <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
      <button className="btn px-2.5 py-1 text-xs" onClick={() => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
        {copied ? <CheckCircle2 size={13} className="text-ok" /> : <ClipboardCopy size={13} />}{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Numbers({ defaults, agents, onSave }: { defaults: PortalDefaults; agents: Agent[]; onSave: (d: PortalDefaults) => void }) {
  const [orn, setOrn] = useState(defaults.orn ?? '');
  const [map, setMap] = useState(defaults.agents ?? {});
  return (
    <section className="card mb-4 p-4 md:p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Users size={16} className="text-brand" />Agency &amp; agents</h2>
      <p className="mb-3 text-sm text-ink-2">Filled in on every new listing. Contact details here are what portals show buyers.</p>
      <label className="mb-3 block text-xs font-medium text-ink-2">Agency ORN (RERA office number)
        <input className="input mt-1 sm:w-48" inputMode="numeric" value={orn} onChange={(e) => setOrn(e.target.value.replace(/\D/g, ''))} />
      </label>
      <ul className="space-y-2">
        {agents.map((a) => {
          const m = map[a.username] ?? {};
          const set = (k: string, val: string) => setMap({ ...map, [a.username]: { ...m, [k]: val } });
          return (
            <li key={a.username} className="rounded-xl border border-line p-2.5">
              <p className="mb-1.5 text-sm font-medium">{a.name} <span className="text-xs font-normal text-ink-3">{a.username}</span></p>
              <div className="grid gap-2 sm:grid-cols-4">
                <input className="input" placeholder="BRN" inputMode="numeric" value={m.brn ?? ''} onChange={(e) => set('brn', e.target.value.replace(/\D/g, ''))} aria-label={`${a.name} BRN`} />
                <input className="input" placeholder="Phone shown to buyers" value={m.phone ?? ''} onChange={(e) => set('phone', e.target.value)} aria-label={`${a.name} phone`} />
                <input className="input" placeholder="Email shown to buyers" value={m.email ?? ''} onChange={(e) => set('email', e.target.value)} aria-label={`${a.name} email`} />
                <input className="input" placeholder="PF user ID" value={m.portalAgentId ?? ''} onChange={(e) => set('portalAgentId', e.target.value)} aria-label={`${a.name} Property Finder user ID`} />
              </div>
            </li>
          );
        })}
      </ul>
      <button className="btn btn-primary mt-3" onClick={() => onSave({ orn, agents: map })}><Save size={15} />Save numbers</button>
    </section>
  );
}

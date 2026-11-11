'use client';
import { useState } from 'react';
import { Check, ClipboardCopy, ClipboardList, Download, ExternalLink, Loader2 } from 'lucide-react';
import { manualSheet, isManual } from '@/lib/proptech/manual';
import { permitReady } from '@/lib/proptech/validate';
import { api } from './ui';
import type { ListingBundle } from '@/lib/proptech/types';

type Target = 'propertyfinder' | 'bayut';
const NAME: Record<Target, string> = { propertyfinder: 'Property Finder', bayut: 'Bayut / dubizzle' };
// The portal's site, opened in a new tab where the agent signs in themselves (we never see their portal password).
const POST_URL: Record<Target, string> = { propertyfinder: 'https://www.propertyfinder.ae', bayut: 'https://www.bayut.com' };

/**
 * Copy & paste posting: every field ready to paste into the portal's own form, in its order,
 * plus all photos as one download. Then "I've posted it" records it like any other publish.
 */
export function ManualPost({ b, setB, setError }: { b: ListingBundle; setB: (x: ListingBundle) => void; setError: (m: string) => void }) {
  const [portal, setPortal] = useState<Target>('propertyfinder');
  const [copied, setCopied] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const l = b.listing;
  const rows = manualSheet(l, portal, b.agent);
  const status = b.portals.find((p) => p.portal === portal);
  const postedByHand = status && isManual(status.externalId) && status.status === 'live';
  const blockers = b.validation.issues.filter((i) => i.level === 'error');

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500); }
    catch { setError('Your browser blocked copying. Select the text and copy it instead.'); }
  };
  const copyAll = () => copy('all', rows.map((r) => `${r.label}: ${r.value}`).join('\n\n'));
  const mark = async (action: 'posted' | 'removed') => {
    setBusy(true);
    try { setB(await api<ListingBundle>(`/api/proptech/listings/${l.id}/manual`, { method: 'POST', json: { portal, reference: ref, action } })); setRef(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <section className="card p-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><ClipboardList size={16} className="text-brand" />Copy &amp; paste posting</h2>
      <p className="mb-3 text-xs text-ink-3">No API needed. Open the portal, then copy each field into its form. Everything is in the portal&apos;s order.</p>

      <div className="mb-3 grid grid-cols-2 rounded-lg border border-line p-0.5 text-sm">
        {(['propertyfinder', 'bayut'] as Target[]).map((p) => (
          <button key={p} onClick={() => setPortal(p)} className={`rounded-md px-2 py-1.5 ${portal === p ? 'bg-panel-2 font-semibold' : 'text-ink-2'}`}>{p === 'bayut' ? 'Bayut' : 'Property Finder'}</button>
        ))}
      </div>

      {!permitReady(l) && <p className="mb-3 rounded-lg bg-warn-soft px-2.5 py-2 text-xs text-warn">Enter a valid Trakheesi permit first. Portals reject listings without one.</p>}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <a className="btn px-2 text-sm" href={POST_URL[portal]} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open {portal === 'bayut' ? 'Bayut' : 'PF'}</a>
        <a className="btn px-2 text-sm" href={`/api/proptech/listings/${l.id}/photos`}><Download size={14} />All photos</a>
      </div>

      <ul className="scroll-thin max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {rows.map((r) => (
          <li key={r.key} className="rounded-lg border border-line px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-ink-3">{r.label}</span>
              <button onClick={() => copy(r.key, r.value)} className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${copied === r.key ? 'text-ok' : 'text-brand hover:bg-panel-2'}`} aria-label={`Copy ${r.label}`}>
                {copied === r.key ? <Check size={12} /> : <ClipboardCopy size={12} />}{copied === r.key ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p dir={r.rtl ? 'rtl' : 'ltr'} className={`text-sm ${r.long ? 'line-clamp-3 whitespace-pre-line' : 'truncate'}`} title={r.value}>{r.value}</p>
          </li>
        ))}
      </ul>
      <button className="btn mt-2 w-full text-sm" onClick={copyAll}>{copied === 'all' ? <Check size={14} className="text-ok" /> : <ClipboardCopy size={14} />}{copied === 'all' ? 'Copied everything' : 'Copy everything as text'}</button>

      <div className="mt-3 border-t border-line pt-3">
        {postedByHand ? (
          <div className="text-sm">
            <p className="mb-2 flex items-center gap-1.5 text-ok"><Check size={15} />Posted by hand on {NAME[portal]}{status?.externalId && status.externalId !== 'manual:posted' ? ` · ${status.externalId.slice(7)}` : ''}</p>
            <button className="btn w-full text-sm" disabled={busy} onClick={() => mark('removed')}>I took it down</button>
          </div>
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-ink-2">After posting: the portal&apos;s listing link or reference (optional)</label>
            <input className="input mb-2" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. https://www.propertyfinder.ae/en/plp/…" />
            <button className="btn btn-primary w-full" disabled={busy || blockers.length > 0} onClick={() => mark('posted')} title={blockers.length ? 'Fix the checklist first' : undefined}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}I&apos;ve posted it on {portal === 'bayut' ? 'Bayut' : 'Property Finder'}
            </button>
            {blockers.length > 0 && <p className="mt-1.5 text-xs text-ink-3">Fix the pre-publish checklist first: the same rules apply when you post by hand.</p>}
          </>
        )}
      </div>
    </section>
  );
}

'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCopy, Copy, Download, Film, Loader2, Lock, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, Upload, XCircle,
} from 'lucide-react';
import { AiProgress, ErrorBar, PortalChip, StatusChip, ago, api, usd, useBundle } from '@/components/proptech/ui';
import { FieldRow, GROUPS, enumLabel } from '@/components/proptech/fields';
import { PhotoGrid } from '@/components/proptech/photos';
import { ManualPost } from '@/components/proptech/ManualPost';
import { chipValue } from '@/lib/proptech/questions';
import { DESC_MAX, DESC_MIN, FIELD_LABEL, TITLE_MAX, copyProblems, permitReady, requiredFields } from '@/lib/proptech/validate';
import { PORTAL_LABEL, TONES, fmtAed, type ListingBundle, type ListingField, type Portal, type Tone, type ValidationIssue } from '@/lib/proptech/types';

const METHOD_LABEL: Record<string, string> = { api: 'Posted by the portal API', feed: 'Sent in your Bayut feed', extension: 'Posted with the Sixty Chrome extension' };

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { b, setB, error, setError, reload } = useBundle(id);
  const [saving, setSaving] = useState(false);

  const save = async (patch: object) => {
    setSaving(true);
    try { setB(await api<ListingBundle>(`/api/proptech/listings/${id}`, { method: 'PATCH', json: patch })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  };
  const saveField = (f: ListingField, v: unknown) => save({ fields: { [f]: v } });

  if (!b) return <div className="grid h-full place-items-center text-ink-3">{error ? <p className="px-6 text-sm text-danger">{error}</p> : <Loader2 className="animate-spin" />}</div>;
  const l = b.listing;
  const processing = l.status === 'processing';
  const required = new Set<string>(requiredFields(l));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <Link href="/proptech" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={15} />Auto Listing</Link>
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2"><StatusChip status={l.status} />{saving && <span className="flex items-center gap-1 text-xs text-ink-3"><Loader2 size={12} className="animate-spin" />Saving</span>}</div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{l.title_en || 'Untitled listing'}</h1>
          <p className="text-sm text-ink-2">{[l.community, l.building].filter(Boolean).join(' · ') || 'Details pending'} · {fmtAed(l.price)} · AI cost <span className="font-medium tabular-nums">{usd(l.aiCostUsd)}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" title="Coming soon" disabled><Film size={15} />Generate listing video — coming soon</button>
          <button className="btn" onClick={async () => { const r = await api<{ id: string }>(`/api/proptech/listings/${id}/duplicate`, { method: 'POST' }).catch((e: Error) => (setError(e.message), null)); if (r) router.push(`/proptech/listings/${r.id}`); }}><Copy size={15} />Duplicate</button>
          {l.status !== 'published' && <button className="btn btn-ghost text-bad" onClick={async () => { if (!confirm('Delete this listing and its files? This cannot be undone.')) return; await api(`/api/proptech/listings/${id}`, { method: 'DELETE' }).then(() => router.push('/proptech')).catch((e: Error) => setError(e.message)); }}><Trash2 size={15} />Delete</button>}
        </div>
      </div>
      <ErrorBar error={error} onClose={() => setError('')} />

      {(processing || l.progress.step === 'writing') && <div className="mb-4"><AiProgress progress={l.progress} hasVoice={b.media.some((m) => m.kind === 'audio')} hasPhotos={b.media.some((m) => m.kind === 'photo')} /></div>}
      {!processing && l.progress.error && <div className="mb-4 flex items-start gap-2 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span className="flex-1">{l.progress.label}</span>
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => api(`/api/proptech/listings/${id}/process`, { method: 'POST' }).then(reload).catch((e: Error) => setError(e.message))}><RefreshCw size={13} />Try again</button></div>}
      {l.status === 'draft' && <div className="mb-4 rounded-xl bg-info-soft px-4 py-3 text-sm text-info">This draft hasn&apos;t been processed yet. <Link className="font-semibold underline" href={`/proptech/new?id=${id}`}>Finish the upload</Link>.</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          {l.aiQuestions.length > 0 && !processing && (
            <section className="card p-4">
              <h2 className="mb-2 flex items-center gap-2 font-semibold"><Sparkles size={16} className="text-ai" />AI asks</h2>
              <div className="space-y-3">
                {l.aiQuestions.map((q) => (
                  <div key={q.field}>
                    <p className="mb-1.5 text-sm">{q.question}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {q.options.map((o) => o === 'Other…'
                        ? <button key={o} className="rounded-full border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-brand" onClick={() => document.getElementById(`field-${q.field}-input`)?.focus()}>Other…</button>
                        : <button key={o} className="rounded-full border border-ai/30 bg-ai-soft px-3 py-1.5 text-sm font-medium text-ai hover:border-ai" onClick={() => saveField(q.field, chipValue(q.field, o))}>{enumLabel(o)}</button>)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {GROUPS.map((g) => (
            <section key={g.key} className="card p-4">
              <h2 className="mb-2 font-semibold">{g.title}</h2>
              <div className="grid gap-1 sm:grid-cols-2">
                {g.fields.map((f) => <div key={f} className={f === 'amenities' || f === 'payment_plan' ? 'sm:col-span-2' : ''}><FieldRow l={l} f={f} required={required} media={b.media} onSave={saveField} disabled={processing} /></div>)}
              </div>
              {g.key === 'features' && <AmenitySuggestions b={b} onAdd={(a) => saveField('amenities', [...l.amenities, a])} />}
            </section>
          ))}

          <Owner b={b} onSave={(owner) => save({ owner })} />
          <Media b={b} reload={reload} setError={setError} />
          <CopyBlock b={b} saveField={saveField} reload={reload} setError={setError} />
          <Notes b={b} save={save} />
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Permit b={b} saveField={saveField} setError={setError} />
          <Publish b={b} setB={setB} setError={setError} />
          <ManualPost b={b} setB={setB} setError={setError} />
        </aside>
      </div>

      <Logs b={b} />
    </div>
  );
}

function AmenitySuggestions({ b, onAdd }: { b: ListingBundle; onAdd: (a: string) => void }) {
  const have = new Set(b.listing.amenities.map((a) => a.toLowerCase()));
  const s = [...new Set(b.media.flatMap((m) => m.flags.amenity_suggestions ?? []))].filter((a) => !have.has(a.toLowerCase())).slice(0, 12);
  if (!s.length) return null;
  return (
    <div className="mt-2 px-2">
      <p className="mb-1.5 text-xs text-ink-3">Seen in the photos (only add what&apos;s really there):</p>
      <div className="flex flex-wrap gap-1.5">{s.map((a) => <button key={a} onClick={() => onAdd(a)} className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand">+ {a}</button>)}</div>
    </div>
  );
}

function Owner({ b, onSave }: { b: ListingBundle; onSave: (o: Record<string, string>) => void }) {
  const o = b.owner ?? {};
  return (
    <section className="card p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Lock size={15} className="text-ink-3" />Owner (from Form A)</h2>
      <p className="mb-2 text-xs text-ink-3">Never published or sent to portals.{b.ownerMasked ? ' Only agency admins can see the full details.' : ''}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['name', 'idNumber', 'phone', 'email'] as const).map((k) => (
          <label key={k} className="block text-xs font-medium text-ink-2">{{ name: 'Name', idNumber: 'Emirates ID / passport', phone: 'Phone', email: 'Email' }[k]}
            <input className="input mt-1" defaultValue={o[k] ?? ''} key={`${k}-${o[k] ?? ''}`} disabled={b.ownerMasked} onBlur={(e) => !b.ownerMasked && e.target.value !== (o[k] ?? '') && onSave({ [k]: e.target.value })} />
          </label>
        ))}
      </div>
    </section>
  );
}

function Media({ b, reload, setError }: { b: ListingBundle; reload: () => void; setError: (m: string) => void }) {
  const id = b.listing.id;
  const photos = b.media.filter((m) => m.kind === 'photo').sort((a, z) => Number(a.removed) - Number(z.removed) || a.order - z.order);
  const docs = b.media.filter((m) => m.kind !== 'photo');
  const patch = (body: object) => api(`/api/proptech/listings/${id}/media`, { method: 'PATCH', json: body }).then(reload).catch((e: Error) => setError(e.message));
  const live = photos.filter((p) => !p.removed);
  const move = (from: number, to: number) => {
    const ids = live.map((p) => p.id);
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    patch({ order: ids });
  };
  return (
    <section id="media" className="card scroll-mt-24 p-4">
      <h2 className="mb-1 font-semibold">Media <span className="font-normal text-ink-3">{live.length} photos</span></h2>
      <p className="mb-3 text-xs text-ink-3">The AI put them in a suggested order and picked a cover. Flags are warnings: portals may reject photos with watermarks or contact details.</p>
      <PhotoGrid items={photos} onMove={(f, t) => move(f, t)} onCover={(pid) => patch({ cover: pid })} onRemove={(pid) => patch({ remove: pid })} onRestore={(pid) => patch({ restore: pid })} />
      {docs.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {docs.map((d) => <li key={d.id}><a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 hover:border-brand"><Upload size={13} className="rotate-180" />{{ form_a: 'Form A', document: d.docType === 'oqood' ? 'Oqood' : 'Title deed', floorplan: 'Floor plan', audio: 'Voice note', photo: 'Photo' }[d.kind]}</a></li>)}
        </ul>
      )}
    </section>
  );
}

function CopyBlock({ b, saveField, reload, setError }: { b: ListingBundle; saveField: (f: ListingField, v: unknown) => void; reload: () => void; setError: (m: string) => void }) {
  const l = b.listing;
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const [tone, setTone] = useState<Tone>(l.tone);
  const busy = l.progress.step === 'writing';
  const t = lang === 'en' ? 'title_en' : 'title_ar';
  const d = lang === 'en' ? 'description_en' : 'description_ar';
  const regen = () => api(`/api/proptech/listings/${l.id}/regenerate`, { method: 'POST', json: { tone } }).then(reload).catch((e: Error) => setError(e.message));
  return (
    <section id="copy" className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Copy</h2>
        <div className="flex rounded-lg border border-line p-0.5 text-sm">
          {(['en', 'ar'] as const).map((x) => <button key={x} onClick={() => setLang(x)} className={`rounded-md px-3 py-1 ${lang === x ? 'bg-panel-2 font-semibold' : 'text-ink-2'}`}>{x === 'en' ? 'English' : 'العربية'}</button>)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select className="input w-auto py-1.5 capitalize" value={tone} onChange={(e) => setTone(e.target.value as Tone)} aria-label="Tone">{TONES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <button className="btn" disabled={busy} onClick={regen}>{busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}Regenerate</button>
        </div>
      </div>
      <CopyField key={`${t}-${l[t]}`} id={`field-${t}`} label={FIELD_LABEL[t]!} value={l[t] ?? ''} max={TITLE_MAX} rtl={lang === 'ar'} onSave={(v) => saveField(t, v)} />
      <CopyField key={`${d}-${l[d]?.length}`} id={`field-${d}`} label={FIELD_LABEL[d]!} value={l[d] ?? ''} min={DESC_MIN} max={DESC_MAX} multiline rtl={lang === 'ar'} onSave={(v) => saveField(d, v)} />
      <p className="text-xs text-ink-3">Written only from the verified details and your notes. No phone numbers, emails, links or emoji.</p>
    </section>
  );
}

function CopyField({ id, label, value, max, min, multiline, rtl, onSave }: { id: string; label: string; value: string; max: number; min?: number; multiline?: boolean; rtl?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const n = v.length;
  const bad = n > max || (min !== undefined && n > 0 && n < min);
  const problems = copyProblems(v);
  return (
    <div id={id} className="mb-3 scroll-mt-24">
      <label htmlFor={`${id}-input`} className="mb-1 flex text-xs font-medium text-ink-2">{label}<span className={`ml-auto tabular-nums ${bad ? 'text-bad' : 'text-ink-3'}`}>{n}{min ? ` / ${min}–${max}` : ` / ${max}`}</span></label>
      {multiline
        ? <textarea id={`${id}-input`} dir={rtl ? 'rtl' : 'ltr'} className={`input min-h-[260px] leading-relaxed ${!v ? 'border-bad/60' : ''}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
        : <input id={`${id}-input`} dir={rtl ? 'rtl' : 'ltr'} className={`input ${!v ? 'border-bad/60' : ''}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />}
      {problems.length > 0 && <p className="mt-1 text-xs text-bad">Remove {problems.join(', ')}.</p>}
    </div>
  );
}

function Notes({ b, save }: { b: ListingBundle; save: (p: object) => void }) {
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-semibold">Agent notes &amp; voice transcript</h2>
      <label className="mb-2 block text-xs font-medium text-ink-2">Notes
        <textarea className="input mt-1 min-h-[70px]" defaultValue={b.inputs.agentNotes} onBlur={(e) => e.target.value !== b.inputs.agentNotes && save({ agentNotes: e.target.value })} />
      </label>
      <label className="block text-xs font-medium text-ink-2">Voice note transcript (edit if the AI misheard)
        <textarea className="input mt-1 min-h-[70px]" defaultValue={b.inputs.voiceTranscript} placeholder="No voice note" onBlur={(e) => e.target.value !== b.inputs.voiceTranscript && save({ voiceTranscript: e.target.value })} />
      </label>
      <p className="mt-1 text-xs text-ink-3">Changed something here? Press Regenerate on the copy to use it.</p>
    </section>
  );
}

function Permit({ b, saveField, setError }: { b: ListingBundle; saveField: (f: ListingField, v: unknown) => void; setError: (m: string) => void }) {
  const l = b.listing;
  const [copied, setCopied] = useState(false);
  const required = new Set<string>(['permit_number', 'permit_expiry', 'agency_orn', 'agent_brn']);
  const copy = async () => {
    try {
      const r = await api<{ text: string }>(`/api/proptech/listings/${l.id}/permit`);
      await navigator.clipboard.writeText(r.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Copy failed'); }
  };
  return (
    <section className="card p-4">
      <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-brand" />Dubai permit</h2>
      <p className="mb-2 text-xs text-ink-3">Apply on Trakheesi yourself, then enter the permit here. Publishing stays locked until it&apos;s valid.</p>
      {(['permit_number', 'permit_expiry', 'agency_orn', 'agent_brn'] as ListingField[]).map((f) => <FieldRow key={f} l={l} f={f} required={required} media={b.media} onSave={saveField} />)}
      <div className="mt-2 grid gap-2">
        <button className="btn" onClick={copy}>{copied ? <CheckCircle2 size={15} className="text-ok" /> : <ClipboardCopy size={15} />}{copied ? 'Copied' : 'Copy permit application data'}</button>
        <a className="btn" href={`/api/proptech/listings/${l.id}/bundle`}><Download size={15} />Download bundle (Form A + details PDF)</a>
      </div>
    </section>
  );
}

function Publish({ b, setB, setError }: { b: ListingBundle; setB: (x: ListingBundle) => void; setError: (m: string) => void }) {
  const l = b.listing;
  const status = useMemo(() => new Map(b.portals.map((p) => [p.portal, p])), [b.portals]);
  const [pick, setPick] = useState<Portal[]>(() => b.connectedPortals.filter((p) => !status.get(p) || ['draft', 'unpublished', 'rejected'].includes(status.get(p)!.status)).slice(0, 2));
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [confirmNeeded, setConfirmNeeded] = useState<ValidationIssue[] | null>(null);
  const permitOk = permitReady(l);
  const errs = b.validation.issues.filter((i) => i.level === 'error');
  const confirms = b.validation.issues.filter((i) => i.level === 'confirm');
  const warns = b.validation.issues.filter((i) => i.level === 'warning');

  const go = async (portals: Portal[], action: 'publish' | 'update', confirm = false) => {
    setBusy(true); setIssues(null);
    try {
      const res = await fetch(`/api/proptech/listings/${l.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portals, action, confirm }) });
      const data = await res.json();
      if (res.status === 409) setConfirmNeeded((data.issues as ValidationIssue[]).filter((i) => i.level === 'confirm'));
      else if (!res.ok) { setIssues(data.issues ?? null); if (!data.issues) setError(data.error); }
      else { setB(data); setConfirmNeeded(null); }
    } finally { setBusy(false); }
  };
  const unpublish = async (p: Portal) => {
    if (!confirm(`Take this listing off ${PORTAL_LABEL[p]}?`)) return;
    setB(await api<ListingBundle>(`/api/proptech/listings/${l.id}/unpublish`, { method: 'POST', json: { portals: [p] } }).catch((e: Error) => (setError(e.message), b)));
  };
  const fix = (field?: string) => {
    if (!field) return;
    const el = document.getElementById(field === 'photos' || field === 'cover' ? 'media' : `field-${field}`) ?? document.getElementById('copy');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (document.getElementById(`field-${field}-input`) as HTMLInputElement | null)?.focus({ preventScroll: true });
  };

  return (
    <section className="card p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold"><Send size={15} className="text-brand" />Publish</h2>

      <div className="mb-3 rounded-xl border border-line p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Pre-publish checklist</p>
        <ul className="space-y-1.5 text-sm">
          <Check ok={permitOk} label="Valid Trakheesi permit" onFix={() => fix('permit_number')} />
          <Check ok={!errs.some((i) => i.field && !['photos', 'cover', 'permit_number', 'permit_expiry'].includes(i.field))} label="Required details filled in" onFix={() => fix(errs.find((i) => i.field && !['photos', 'cover'].includes(i.field))?.field)} />
          <Check ok={!errs.some((i) => i.field === 'photos' || i.field === 'cover')} label="At least 5 good photos and a clean cover" onFix={() => fix('photos')} />
          <Check ok={!errs.some((i) => ['title_en', 'description_en', 'title_ar', 'description_ar'].includes(i.field ?? ''))} label="Title and description fit the rules" onFix={() => fix('description_en')} />
        </ul>
        {errs.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
            {errs.map((i, k) => <li key={k} className="flex gap-1.5 text-bad"><XCircle size={13} className="mt-0.5 shrink-0" /><span className="flex-1">{i.message}</span>{i.field && <button className="font-semibold underline" onClick={() => fix(i.field)}>Fix</button>}</li>)}
          </ul>
        )}
        {[...confirms, ...warns].length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {[...confirms, ...warns].map((i, k) => <li key={k} className="flex gap-1.5 text-warn"><AlertTriangle size={13} className="mt-0.5 shrink-0" /><span className="flex-1">{i.message}</span>{i.field && <button className="font-semibold underline" onClick={() => fix(i.field)}>Check</button>}</li>)}
          </ul>
        )}
      </div>

      <p className="mb-1.5 text-xs font-medium text-ink-2">Portals</p>
      {b.connectedPortals.length === 0 && <p className="text-sm text-ink-3">No portals connected. An admin can connect them in Portal Settings.</p>}
      <ul className="mb-3 space-y-2">
        {b.connectedPortals.map((p) => {
          const s = status.get(p);
          return (
            <li key={p} className="rounded-xl border border-line p-2.5">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={pick.includes(p)} onChange={(e) => setPick(e.target.checked ? [...pick, p] : pick.filter((x) => x !== p))} />
                {PORTAL_LABEL[p]}
                {s && <span className="ml-auto"><PortalChip portal={p} status={s.status} short /></span>}
              </label>
              <p className="mt-0.5 pl-6 text-[11px] text-ink-3">{METHOD_LABEL[b.methods[p] ?? 'api']}</p>
              {s && b.methods[p] === 'extension' && s.status === 'queued' && <p className="mt-1 pl-6 text-xs text-info">Waiting in the Sixty Chrome extension. Open it in Chrome and press Post.</p>}
              {s?.externalId && s.externalId !== 'ext:pending' && <p className="mt-1 truncate pl-6 text-xs text-ink-3">{/^(ext|manual):/.test(s.externalId) ? <>Posted by {s.externalId.startsWith('ext:') ? 'extension' : 'hand'}{/^(ext|manual):https?:/.test(s.externalId) && <> · <a className="underline" href={s.externalId.replace(/^(ext|manual):/, '')} target="_blank" rel="noreferrer">view</a></>}</> : <>ID {s.externalId}</>}{s.lastSyncedAt ? ` · ${ago(s.lastSyncedAt)}` : ''}</p>}
              {s?.status === 'rejected' && s.lastError && (
                <div className="mt-2 rounded-lg bg-bad-soft px-2.5 py-2 text-xs text-bad">
                  {s.lastError.plain}{s.lastError.field && <> <button className="font-semibold underline" onClick={() => fix(s.lastError!.field)}>Fix</button></>}
                </div>
              )}
              {s && ['submitted', 'live'].includes(s.status) && (
                <div className="mt-2 flex gap-2 pl-6">
                  <button className="btn px-2.5 py-1 text-xs" disabled={busy || !b.validation.ok} onClick={() => go([p], 'update', true)}><RefreshCw size={12} />Update</button>
                  <button className="btn px-2.5 py-1 text-xs" disabled={busy} onClick={() => unpublish(p)}>Unpublish</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {issues && issues.length > 0 && <ul className="mb-2 space-y-1 text-xs text-bad">{issues.map((i, k) => <li key={k}>• {i.message}</li>)}</ul>}
      {confirmNeeded ? (
        <div className="rounded-xl border border-warn/50 bg-warn-soft p-3 text-sm">
          {confirmNeeded.map((i, k) => <p key={k} className="mb-1 text-warn">{i.message}</p>)}
          <div className="mt-2 flex gap-2"><button className="btn btn-primary" disabled={busy} onClick={() => go(pick, 'publish', true)}>Yes, it&apos;s right. Publish</button><button className="btn" onClick={() => setConfirmNeeded(null)}>Cancel</button></div>
        </div>
      ) : (
        <button className="btn btn-primary w-full" disabled={busy || !pick.length || !b.validation.ok || l.status === 'processing'} onClick={() => go(pick, 'publish')}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : !permitOk ? <Lock size={16} /> : <Send size={16} />}
          {!permitOk ? 'Enter the permit to publish' : !b.validation.ok ? 'Fix the checklist to publish' : 'Approve & publish'}
        </button>
      )}
      <p className="mt-2 text-xs text-ink-3">Publishing means you&apos;ve checked every detail. It&apos;s logged with your name.</p>
      <p className="mt-1 text-xs text-ink-3">Portals without an API go to your Sixty Chrome extension. <span className="text-ink-2">Coming next: a Sixty browser that posts for you.</span></p>
    </section>
  );
}

function Check({ ok, label, onFix }: { ok: boolean; label: string; onFix: () => void }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <CheckCircle2 size={15} className="text-ok" /> : <XCircle size={15} className="text-bad" />}
      <span className={`flex-1 ${ok ? '' : 'text-ink-2'}`}>{label}</span>
      {!ok && <button className="text-xs font-semibold text-brand" onClick={onFix}>Fix</button>}
    </li>
  );
}

function Logs({ b }: { b: ListingBundle }) {
  const total = b.usage.reduce((t, u) => t + u.costUsd, 0);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">AI cost <span className="font-normal tabular-nums text-ink-2">{usd(b.listing.aiCostUsd || total)}</span></h2>
        {b.usage.length === 0 ? <p className="text-sm text-ink-3">No AI calls yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead className="text-left text-ink-3"><tr><th className="py-1 font-medium">Step</th><th className="font-medium">Model</th><th className="text-right font-medium">Tokens</th><th className="text-right font-medium">Cost</th></tr></thead>
            <tbody>{b.usage.map((u, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{u.task.replace(/_/g, ' ')}{!u.ok && <span className="ml-1 text-bad">(failed)</span>}</td><td className="text-ink-2">{u.model}</td><td className="text-right tabular-nums">{(u.inputTokens + u.outputTokens).toLocaleString()}</td><td className="text-right tabular-nums">{usd(u.costUsd)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Audit log</h2>
        {b.audit.length === 0 ? <p className="text-sm text-ink-3">Publishing, unpublishing and permit edits show up here.</p> : (
          <ul className="space-y-1.5 text-sm">{b.audit.map((a) => <li key={a.id} className="flex gap-2"><span className="w-24 shrink-0 text-xs text-ink-3">{ago(a.createdAt)}</span><span><span className="font-medium">{a.actor}</span> {a.action.replace('_', ' ')}{Array.isArray(a.detail.portals) ? ` · ${(a.detail.portals as Portal[]).map((p) => PORTAL_LABEL[p]).join(', ')}` : ''}</span></li>)}</ul>
        )}
      </section>
      {b.canAdmin && (
        <section className="card p-4 lg:col-span-2">
          <h2 className="mb-2 font-semibold">Portal event log <span className="text-xs font-normal text-ink-3">(admins only)</span></h2>
          {b.events.length === 0 ? <p className="text-sm text-ink-3">No portal calls yet.</p> : (
            <ul className="divide-y divide-line text-xs">
              {b.events.map((e) => (
                <li key={e.id} className="py-1.5">
                  <details>
                    <summary className="flex cursor-pointer items-center gap-2">
                      {e.ok ? <CheckCircle2 size={13} className="text-ok" /> : <XCircle size={13} className="text-bad" />}
                      <span className="font-medium">{PORTAL_LABEL[e.portal as Portal] ?? e.portal}</span><span>{e.action}</span>
                      {e.error && <span className="truncate text-bad">{e.error}</span>}
                      <span className="ml-auto shrink-0 text-ink-3">{e.durationMs != null ? `${e.durationMs}ms · ` : ''}{ago(e.createdAt)}</span>
                    </summary>
                    <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-panel-2 p-2 text-[11px]">{JSON.stringify({ request: e.request, response: e.response }, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

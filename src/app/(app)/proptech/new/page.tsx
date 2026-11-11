'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CheckCircle2, ChevronDown, FileText, Loader2, Mic, NotebookPen, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { AiProgress, ErrorBar, api, uploadFile, useBundle } from '@/components/proptech/ui';
import { PhotoGrid, type PhotoItem } from '@/components/proptech/photos';
import { VoiceNote } from '@/components/proptech/VoiceNote';
import { checkUpload, MAX_PHOTOS, MIN_PHOTOS, type UploadKind } from '@/lib/proptech/files';

type DocItem = { id: string; name: string; kind: UploadKind; docType?: string; uploading?: number; error?: string };
type Voice = { blob: Blob; name: string; url: string; seconds: number } | null;

const ACCEPT_DOC = 'application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif,.pdf';
const ACCEPT_PHOTO = 'image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif';

export default function NewListingPage() {
  return <Suspense><Batch /></Suspense>;
}

/** What each draft card tells the page. */
type DraftState = { id: string | null; ready: boolean; uploading: boolean; empty: boolean; notes: string; voice: Voice; title: string };
type Draft = { key: string; initialId?: string };
const MAX_DRAFTS = 10;

// Several listings at once: each card is one listing (its own Form A, photos, notes, voice note).
// "Read & write" starts the AI on every ready card in parallel; the job queue runs them side by side.
function Batch() {
  const router = useRouter();
  const params = useSearchParams();
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const ids = (params.get('ids') ?? params.get('id') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, MAX_DRAFTS);
    return ids.length ? ids.map((id) => ({ key: id, initialId: id })) : [{ key: crypto.randomUUID() }];
  });
  const [open, setOpen] = useState(drafts[0].key);
  const [states, setStates] = useState<Record<string, DraftState>>({});
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<{ id: string; hasVoice: boolean }[] | null>(null);

  const report = useCallback((key: string, st: DraftState) => setStates((s) => {
    const prev = s[key];
    if (prev && prev.id === st.id && prev.ready === st.ready && prev.uploading === st.uploading && prev.empty === st.empty && prev.notes === st.notes && prev.voice === st.voice && prev.title === st.title) return s;
    return { ...s, [key]: st };
  }), []);

  // Keep every draft id in the URL so a refresh brings them all back.
  const ids = drafts.map((d) => states[d.key]?.id).filter(Boolean) as string[];
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!started) window.history.replaceState(null, '', idsKey ? `/proptech/new?ids=${idsKey}` : '/proptech/new');
  }, [idsKey, started]);

  const add = () => {
    if (drafts.length >= MAX_DRAFTS) return setError(`Up to ${MAX_DRAFTS} listings at a time.`);
    const key = crypto.randomUUID();
    setDrafts((d) => [...d, { key }]);
    setOpen(key);
  };
  const remove = async (key: string) => {
    const st = states[key];
    if (st && !st.empty && !confirm('Remove this listing and its uploads?')) return;
    if (st?.id) await api(`/api/proptech/listings/${st.id}`, { method: 'DELETE' }).catch(() => {});
    setDrafts((d) => d.filter((x) => x.key !== key));
    setStates((s) => { const n = { ...s }; delete n[key]; return n; });
    if (open === key) setOpen(drafts.find((d) => d.key !== key)?.key ?? '');
  };

  const list = drafts.map((d) => ({ d, st: states[d.key] }));
  const ready = list.filter((x) => x.st?.ready && x.st.id);
  const uploading = list.some((x) => x.st?.uploading);
  const notReady = list.filter((x) => !x.st?.ready && !x.st?.empty).length;

  const start = async () => {
    if (!ready.length || uploading) return;
    setStarting(true);
    setError('');
    const ok: { id: string; hasVoice: boolean }[] = [];
    const errs: string[] = [];
    await Promise.all(ready.map(async ({ st }, i) => {
      const id = st!.id!;
      try {
        if (st!.voice) await uploadFile(id, st!.voice.blob, st!.voice.name, 'audio');
        await api(`/api/proptech/listings/${id}/process`, { method: 'POST', json: { agentNotes: st!.notes } });
        ok.push({ id, hasVoice: Boolean(st!.voice) });
      } catch (e) {
        errs.push(`Listing ${i + 1}: ${e instanceof Error ? e.message : 'could not start'}`);
      }
    }));
    setStarting(false);
    if (errs.length) setError(errs.join(' · '));
    if (ok.length === 1 && ready.length === 1 && drafts.length === 1) { setStarted(ok); return; }
    if (ok.length) setStarted(ok);
  };

  if (started) return started.length === 1 ? <Processing id={started[0].id} hasVoice={started[0].hasVoice} /> : <BatchProgress items={started} onDone={() => router.push('/proptech')} />;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 md:px-8">
      <Link href="/proptech" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={15} />Auto Listing</Link>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{drafts.length > 1 ? `${drafts.length} new listings` : 'New listing'}</h1>
          <p className="text-sm text-ink-2">Upload the Form A and the photos. The AI reads them, asks only for what&apos;s missing and writes the English and Arabic copy.{drafts.length > 1 ? ' All listings are processed at the same time.' : ''}</p>
        </div>
        <button className="btn" onClick={add} disabled={drafts.length >= MAX_DRAFTS}><Plus size={16} />Add another listing</button>
      </div>
      <ErrorBar error={error} onClose={() => setError('')} />

      {drafts.map((d, i) => {
        const st = states[d.key];
        const isOpen = open === d.key || drafts.length === 1;
        return (
          <div key={d.key} className={drafts.length > 1 ? 'card mb-3 overflow-hidden' : ''}>
            {drafts.length > 1 && (
              <div className="flex items-center gap-3 px-4 py-3">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(isOpen ? '' : d.key)} aria-expanded={isOpen}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${st?.ready ? 'bg-ok text-white' : 'bg-panel-2 text-ink-2'}`}>{st?.ready ? <CheckCircle2 size={16} /> : i + 1}</span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-semibold">{st?.title || `Listing ${i + 1}`}</span>
                    <span className="block text-xs text-ink-3">{st?.uploading ? 'Uploading…' : st?.ready ? 'Ready' : st?.empty ? 'Nothing added yet' : 'Needs Form A and 5+ photos'}</span>
                  </span>
                  <ChevronDown size={18} className={`shrink-0 text-ink-3 transition ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                <button className="rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-bad" onClick={() => remove(d.key)} aria-label={`Remove listing ${i + 1}`}><Trash2 size={16} /></button>
              </div>
            )}
            <div className={isOpen ? (drafts.length > 1 ? 'border-t border-line bg-panel-2/40 px-3 pb-1 pt-3 md:px-4' : '') : 'hidden'}>
              <DraftEditor draftKey={d.key} initialId={d.initialId} onState={report} onError={setError} />
            </div>
          </div>
        );
      })}

      <button className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-3 text-sm font-medium text-ink-2 hover:border-brand/50 hover:text-ink disabled:opacity-50" onClick={add} disabled={drafts.length >= MAX_DRAFTS}>
        <Plus size={16} />Add another listing
      </button>

      <div className="sticky bottom-0 z-20 -mx-4 mt-2 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-ink-2">
            {uploading ? 'Uploading…'
              : !ready.length ? (drafts.length > 1 ? 'Each listing needs its Form A and at least 5 photos.' : 'Add the Form A and at least 5 photos to continue.')
              : drafts.length === 1 ? 'Ready. This takes about a minute.'
              : `${ready.length} of ${drafts.length} ready.${notReady ? ' The others stay as drafts.' : ''} About a minute for all.`}
          </p>
          <button className="btn btn-primary" disabled={!ready.length || uploading || starting} onClick={start}>
            {starting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {ready.length > 1 ? `Read & write ${ready.length} listings` : 'Read & write listing'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One listing's uploads. Creates its draft on the first upload and reports its state to the page. */
function DraftEditor({ draftKey, initialId, onState, onError }: { draftKey: string; initialId?: string; onState: (key: string, s: DraftState) => void; onError: (m: string) => void }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(initialId ?? null);
  const idPromise = useRef<Promise<string> | null>(null);
  const [formA, setFormA] = useState<DocItem[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [notes, setNotes] = useState('');
  const [voice, setVoice] = useState<Voice>(null);
  const setError = onError;

  // Resume a draft after a refresh.
  useEffect(() => {
    if (!initialId) return;
    api<{ media: { id: string; kind: string; fileName: string; url?: string; isCover: boolean; flags: object; roomType: string | null; width: number | null; height: number | null; removed: boolean; docType: string | null }[]; inputs: { agentNotes: string }; listing: { status: string } }>(`/api/proptech/listings/${initialId}`)
      .then((b) => {
        if (b.listing.status !== 'draft') { router.replace(`/proptech/listings/${initialId}`); return; }
        setFormA(b.media.filter((m) => m.kind === 'form_a').map((m) => ({ id: m.id, name: m.fileName, kind: 'form_a' })));
        setDocs(b.media.filter((m) => m.kind === 'document' || m.kind === 'floorplan').map((m) => ({ id: m.id, name: m.fileName, kind: m.kind as UploadKind, docType: m.docType ?? undefined })));
        setPhotos(b.media.filter((m) => m.kind === 'photo' && !m.removed).map((m) => ({ ...m, flags: m.flags as PhotoItem['flags'] })));
        setNotes(b.inputs.agentNotes);
      }).catch(() => setId(null));
  }, [initialId, router]);

  const ensureId = useCallback(() => {
    if (id) return Promise.resolve(id);
    idPromise.current ??= api<{ id: string }>('/api/proptech/listings', { method: 'POST' }).then((r) => { setId(r.id); return r.id; });
    return idPromise.current;
  }, [id]);

  // Up to 3 uploads at a time.
  const [queue] = useState(() => new UploadQueue(3));

  const addFiles = useCallback((list: FileList | File[], kind: UploadKind, docType?: string) => {
    let files = [...list];
    if (kind === 'photo') {
      const room = MAX_PHOTOS - photos.filter((p) => !p.error).length;
      if (files.length > room) { setError(`Up to ${MAX_PHOTOS} photos. ${files.length - room} were left out.`); files = files.slice(0, Math.max(0, room)); }
    }
    for (const f of files) {
      const chk = checkUpload(kind, f.name, f.size);
      if ('error' in chk) { setError(chk.error); continue; }
      const tmp = `tmp-${crypto.randomUUID()}`;
      const setItem = (patch: Partial<PhotoItem & DocItem>) => {
        if (kind === 'photo') setPhotos((ps) => ps.map((p) => (p.id === tmp || p.id === patch.id ? { ...p, ...patch } : p)));
        else (kind === 'form_a' ? setFormA : setDocs)((ds) => ds.map((d) => (d.id === tmp ? { ...d, ...patch } : d)));
      };
      if (kind === 'photo') {
        setPhotos((ps) => [...ps, { id: tmp, fileName: f.name, localUrl: /heic|heif/i.test(f.type + f.name) ? undefined : URL.createObjectURL(f), isCover: false, flags: {}, roomType: null, width: null, height: null, removed: false, uploading: 0 }]);
      } else {
        (kind === 'form_a' ? setFormA : setDocs)((ds) => [...ds, { id: tmp, name: f.name, kind, docType, uploading: 0 }]);
      }
      queue.add(async () => {
        try {
          const lid = await ensureId();
          const { media } = await uploadFile(lid, f, f.name, kind, docType ? { docType } : {}, (pct) => setItem({ uploading: pct }));
          if (kind === 'photo') setPhotos((ps) => ps.map((p) => (p.id === tmp ? { ...p, ...media, localUrl: p.localUrl, uploading: undefined } : p)));
          else setItem({ id: media.id, uploading: undefined });
        } catch (e) {
          setItem({ error: e instanceof Error ? e.message : 'Upload failed', uploading: undefined });
        }
      });
    }
  }, [ensureId, photos, queue, setError]);

  const patchMedia = (body: object) => id && api(`/api/proptech/listings/${id}/media`, { method: 'PATCH', json: body }).catch((e: Error) => setError(e.message));
  const movePhoto = (from: number, to: number) => {
    setPhotos((ps) => {
      const next = [...ps];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      patchMedia({ order: next.filter((p) => !p.id.startsWith('tmp-')).map((p) => p.id) });
      return next;
    });
  };
  const setCover = (pid: string) => { setPhotos((ps) => ps.map((p) => ({ ...p, isCover: p.id === pid }))); patchMedia({ cover: pid }); };
  const removeFile = async (mid: string, kind: 'photo' | 'doc' | 'form_a') => {
    if (kind === 'photo') setPhotos((ps) => ps.filter((p) => p.id !== mid));
    else (kind === 'form_a' ? setFormA : setDocs)((ds) => ds.filter((d) => d.id !== mid));
    if (id && !mid.startsWith('tmp-')) await api(`/api/proptech/listings/${id}/media?mediaId=${mid}`, { method: 'DELETE' }).catch(() => {});
  };

  const okPhotos = photos.filter((p) => !p.error && !p.id.startsWith('tmp-'));
  const uploading = [...photos, ...formA, ...docs].some((x) => x.uploading !== undefined);
  const formAOk = formA.some((d) => !d.error && !d.id.startsWith('tmp-'));
  const ready = formAOk && okPhotos.length >= MIN_PHOTOS && !uploading;

  const empty = !formA.length && !photos.length && !docs.length && !notes && !voice;
  const title = formA.find((d) => !d.error)?.name.replace(/\.[a-z0-9]+$/i, '') ?? '';
  useEffect(() => {
    onState(draftKey, { id, ready, uploading, empty, notes, voice, title });
  }, [draftKey, id, ready, uploading, empty, notes, voice, title, onState]);

  return (
    <div>
      <Section icon={FileText} title="Form A / listing form" badge="Required" hint="PDF or photos of each page (JPG, PNG, HEIC). Several pages are fine.">
        <DropZone accept={ACCEPT_DOC} multiple label="Add Form A" onFiles={(f) => addFiles(f, 'form_a')} />
        <FileList items={formA} onRemove={(d) => removeFile(d, 'form_a')} />
      </Section>

      <Section icon={Camera} title="Property photos" badge={`${okPhotos.length} / ${MIN_PHOTOS}–${MAX_PHOTOS}`} hint="Drag to reorder (or use the arrows), tap the star to pick the cover. The AI also suggests an order.">
        <DropZone accept={ACCEPT_PHOTO} multiple label="Add photos" onFiles={(f) => addFiles(f, 'photo')} />
        {photos.length > 0 && <div className="mt-3"><PhotoGrid items={photos} onMove={movePhoto} onCover={setCover} onRemove={(pid) => removeFile(pid, 'photo')} /></div>}
        {okPhotos.length > 0 && okPhotos.length < MIN_PHOTOS && <p className="mt-2 text-xs text-warn">Add {MIN_PHOTOS - okPhotos.length} more photo{MIN_PHOTOS - okPhotos.length > 1 ? 's' : ''} (portals need at least {MIN_PHOTOS}).</p>}
      </Section>

      <Section icon={FileText} title="Title deed, Oqood or floor plan" badge="Optional" hint="Helps the AI confirm the unit, size and owner.">
        <div className="flex flex-wrap gap-2">
          <DropZone accept={ACCEPT_DOC} label="Title deed" small onFiles={(f) => addFiles(f, 'document', 'title_deed')} />
          <DropZone accept={ACCEPT_DOC} label="Oqood" small onFiles={(f) => addFiles(f, 'document', 'oqood')} />
          <DropZone accept={ACCEPT_DOC} label="Floor plan" small onFiles={(f) => addFiles(f, 'floorplan')} />
        </div>
        <FileList items={docs} onRemove={(d) => removeFile(d, 'doc')} />
      </Section>

      <Section icon={NotebookPen} title="Agent notes" badge="Optional">
        <textarea className="input min-h-[96px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000}
          placeholder="Anything the documents don't say: views, upgrades, vacancy, payment plan, negotiability…" />
      </Section>

      <Section icon={Mic} title="Voice note" badge="Optional" hint="Up to 3 minutes. Talk through the property like you would to a colleague.">
        <VoiceNote value={voice} onChange={setVoice} onError={setError} />
      </Section>
    </div>
  );
}

/** Live progress for several listings processed together. */
function BatchProgress({ items, onDone }: { items: { id: string; hasVoice: boolean }[]; onDone: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold">Building {items.length} listings</h1>
      <p className="mb-5 text-sm text-ink-2">They run at the same time. Open any one to review it as soon as it&apos;s ready; you can also leave this page.</p>
      <ul className="space-y-3">{items.map((it, i) => <BatchRow key={it.id} n={i + 1} id={it.id} hasVoice={it.hasVoice} />)}</ul>
      <button className="btn mt-5 w-full" onClick={onDone}>Go to Auto Listing</button>
    </div>
  );
}

function BatchRow({ n, id, hasVoice }: { n: number; id: string; hasVoice: boolean }) {
  const { b } = useBundle(id);
  const p = b?.listing.progress;
  const done = p?.step === 'done' && b?.listing.status !== 'processing';
  return (
    <li className="card p-4">
      <div className="mb-2 flex items-center gap-3">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? 'bg-ok text-white' : 'bg-ai-soft text-ai'}`}>{done ? <CheckCircle2 size={14} /> : n}</span>
        <p className="min-w-0 flex-1 truncate font-medium">{b?.listing.title_en || `Listing ${n}`}</p>
        {done ? <Link className="btn btn-primary px-3 py-1.5 text-sm" href={`/proptech/listings/${id}`}>Review</Link> : <Loader2 size={16} className="animate-spin text-ai" />}
      </div>
      {p && !done && <p className="text-sm text-ink-2">{p.label ?? 'Starting…'}</p>}
      {done && p?.error && <p className="text-xs text-warn">{p.label}</p>}
      {!done && p && <div className="mt-2"><MiniSteps done={p.done ?? []} hasVoice={hasVoice} /></div>}
    </li>
  );
}

function MiniSteps({ done, hasVoice }: { done: string[]; hasVoice: boolean }) {
  const steps = [['form_a', 'Form A'], ['photos', 'Photos'], ...(hasVoice ? [['voice', 'Voice']] : []), ['copy_en', 'English'], ['copy_ar', 'Arabic']];
  return (
    <div className="flex flex-wrap gap-1.5">
      {steps.map(([k, l]) => <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${done.includes(k) ? 'bg-ok-soft text-ok' : 'bg-panel-2 text-ink-3'}`}>{l}</span>)}
    </div>
  );
}

class UploadQueue {
  private jobs: (() => Promise<void>)[] = [];
  private active = 0;
  constructor(private limit: number) {}
  add(job: () => Promise<void>) { this.jobs.push(job); this.next(); }
  private next() {
    while (this.active < this.limit && this.jobs.length) {
      const job = this.jobs.shift()!;
      this.active++;
      job().finally(() => { this.active--; this.next(); });
    }
  }
}

function Processing({ id, hasVoice }: { id: string; hasVoice: boolean }) {
  const router = useRouter();
  const { b, error } = useBundle(id);
  useEffect(() => {
    if (b && b.listing.status !== 'processing' && b.listing.progress.step === 'done') {
      const t = setTimeout(() => router.push(`/proptech/listings/${id}`), 900);
      return () => clearTimeout(t);
    }
  }, [b, id, router]);
  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-1 text-xl font-semibold">Building your listing</h1>
      <p className="mb-5 text-sm text-ink-2">You can leave this page; the listing keeps processing and shows up in Auto Listing.</p>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {b ? <AiProgress progress={b.listing.progress} hasVoice={hasVoice} /> : <div className="card grid h-40 place-items-center"><Loader2 className="animate-spin text-ink-3" /></div>}
      {b?.listing.progress.step === 'done' && <p className="mt-4 flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={16} />Opening the review…</p>}
    </div>
  );
}

function Section({ icon: Icon, title, badge, hint, children }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; badge?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card mb-3 p-4 md:p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Icon size={17} className="text-brand" />{title}{badge && <span className="ml-auto rounded-md bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">{badge}</span>}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-ink-3">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function DropZone({ accept, multiple, label, onFiles, small }: { accept: string; multiple?: boolean; label: string; onFiles: (f: FileList) => void; small?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div onClick={() => ref.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}
      role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm font-medium transition ${over ? 'border-brand bg-brand/5 text-brand' : 'border-line text-ink-2 hover:border-brand/50'} ${small ? 'px-3 py-2.5' : 'px-4 py-6'}`}>
      <Upload size={16} />{label}{!small && <span className="hidden font-normal text-ink-3 sm:inline">or drop files here</span>}
      <input ref={ref} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

function FileList({ items, onRemove }: { items: DocItem[]; onRemove: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <FileText size={15} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate">{d.name}{d.docType && <span className="ml-1 text-xs capitalize text-ink-3">· {d.docType.replace('_', ' ')}</span>}</span>
          {d.error ? <span className="text-xs text-bad">{d.error}</span> : d.uploading !== undefined ? <span className="text-xs tabular-nums text-ink-3">{d.uploading}%</span> : <CheckCircle2 size={15} className="text-ok" />}
          <button aria-label={`Remove ${d.name}`} onClick={() => onRemove(d.id)} className="rounded-md p-1 text-ink-3 hover:text-bad"><Trash2 size={14} /></button>
        </li>
      ))}
    </ul>
  );
}

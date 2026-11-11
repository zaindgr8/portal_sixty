'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { api } from '@/lib/whatsapp/client';
import { PORTAL_LABEL, type ListingBundle, type ListingStatus, type Portal, type PortalStatus, type Progress } from '@/lib/proptech/types';

export { api };

const LISTING_STATUS: Record<ListingStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-panel-2 text-ink-2' },
  processing: { label: 'AI working', cls: 'bg-ai-soft text-ai' },
  review: { label: 'Needs review', cls: 'bg-warn-soft text-warn' },
  approved: { label: 'Approved', cls: 'bg-info-soft text-info' },
  published: { label: 'Published', cls: 'bg-ok-soft text-ok' },
  archived: { label: 'Archived', cls: 'bg-panel-2 text-ink-3' },
  failed: { label: 'Failed', cls: 'bg-bad-soft text-bad' },
};
export function StatusChip({ status }: { status: ListingStatus }) {
  const s = LISTING_STATUS[status] ?? LISTING_STATUS.draft;
  return <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export const PORTAL_STATUS: Record<PortalStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-panel-2 text-ink-2' },
  queued: { label: 'Queued', cls: 'bg-panel-2 text-ink-2' },
  submitted: { label: 'Submitted', cls: 'bg-info-soft text-info' },
  live: { label: 'Live', cls: 'bg-ok-soft text-ok' },
  rejected: { label: 'Rejected', cls: 'bg-bad-soft text-bad' },
  expired: { label: 'Expired', cls: 'bg-warn-soft text-warn' },
  unpublished: { label: 'Unpublished', cls: 'bg-panel-2 text-ink-3' },
};
const SHORT: Record<Portal, string> = { propertyfinder: 'PF', bayut: 'Bayut', mock: 'Demo' };
export function PortalChip({ portal, status, short }: { portal: Portal; status: PortalStatus; short?: boolean }) {
  const s = PORTAL_STATUS[status];
  return <span className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium ${s.cls}`}>{short ? SHORT[portal] : PORTAL_LABEL[portal]} · {s.label}</span>;
}

const STEPS = [
  { key: 'form_a', label: 'Reading Form A' },
  { key: 'photos', label: 'Analysing photos' },
  { key: 'voice', label: 'Transcribing voice note' },
  { key: 'copy_en', label: 'Writing English description' },
  { key: 'copy_ar', label: 'Writing Arabic description' },
];

/** Live progress of the AI step. */
export function AiProgress({ progress, hasVoice = true, hasPhotos = true }: { progress: Progress; hasVoice?: boolean; hasPhotos?: boolean }) {
  const done = new Set(progress.done ?? []);
  const running = progress.step !== 'done';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const end = progress.finishedAt ? new Date(progress.finishedAt).getTime() : now;
  const secs = progress.startedAt ? Math.max(0, Math.round((end - new Date(progress.startedAt).getTime()) / 1000)) : 0;
  const steps = STEPS.filter((s) => (hasVoice || s.key !== 'voice') && (hasPhotos || s.key !== 'photos'));
  const current = steps.find((s) => !done.has(s.key))?.key;
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-3">
        {running ? <Loader2 className="animate-spin text-ai" size={20} /> : <CheckCircle2 className="text-ok" size={20} />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{progress.label ?? 'Working…'}</p>
          <p className="text-xs tabular-nums text-ink-3">{secs}s</p>
        </div>
      </div>
      <ol className="space-y-2 text-sm">
        {steps.map((s) => {
          const ok = done.has(s.key);
          const skipped = !running && !ok;
          return (
            <li key={s.key} className="flex items-center gap-2.5">
              {ok ? <CheckCircle2 size={16} className="text-ok" />
                : skipped ? <XCircle size={16} className="text-ink-3" />
                : s.key === current ? <Loader2 size={16} className="animate-spin text-ai" />
                : <Circle size={16} className="text-ink-3" />}
              <span className={ok ? '' : 'text-ink-2'}>{s.label}{skipped ? ' (not done)' : ok ? '' : '…'}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Load a listing bundle and keep it fresh while the AI or a portal is working. */
export function useBundle(id: string) {
  const [b, setBState] = useState<ListingBundle | null>(null);
  const [error, setError] = useState('');
  const ref = useRef<ListingBundle | null>(null);
  const setB = useCallback((x: ListingBundle) => { ref.current = x; setBState(x); }, []);
  const load = useCallback(() => api<ListingBundle>(`/api/proptech/listings/${id}`).then((r) => { setB(r); setError(''); }).catch((e: Error) => setError(e.message)), [id, setB]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => {
      const cur = ref.current;
      if (!cur || document.visibilityState !== 'visible') return;
      const busy = cur.listing.status === 'processing' || cur.listing.progress.step === 'writing' || cur.portals.some((p) => (p.status === 'queued' || p.status === 'submitted') && cur.methods?.[p.portal] !== 'extension');
      if (busy) load();
    }, 2000);
    return () => clearInterval(t);
  }, [load]);
  return { b, setB, error, setError, reload: load };
}

export function ErrorBar({ error, onClose }: { error: string; onClose: () => void }) {
  if (!error) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      <span className="flex-1">{error}</span>
      <button onClick={onClose} aria-label="Dismiss"><XCircle size={16} /></button>
    </div>
  );
}

type UploadedMedia = ListingBundle['media'][number];

/**
 * Upload one file with progress. The file goes straight to storage through a one-time link (the live portal
 * can't take request bodies over 4.5 MB), then the portal checks it and records it.
 */
export async function uploadFile(listingId: string, file: File | Blob, name: string, kind: string, extra: Record<string, string> = {}, onProgress?: (pct: number) => void) {
  const url = `/api/proptech/listings/${listingId}/media`;
  const { path, uploadUrl } = await api<{ path: string; uploadUrl: string }>(url, { method: 'POST', json: { step: 'sign', kind, name, size: file.size } });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); // fetch can't report upload progress, XHR can
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}). Try again.`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
  const r = await api<{ media: UploadedMedia }>(url, { method: 'POST', json: { step: 'done', kind, name, path, ...extra } });
  onProgress?.(100);
  return r;
}

export const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
export function ago(iso: string | null | undefined) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

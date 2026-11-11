'use client';
import { useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, RotateCcw, Star, Trash2 } from 'lucide-react';
import type { ListingMedia, MediaFlags } from '@/lib/proptech/types';

export type PhotoItem = Pick<ListingMedia, 'id' | 'url' | 'isCover' | 'flags' | 'roomType' | 'width' | 'height' | 'fileName' | 'removed'> & { uploading?: number; error?: string; localUrl?: string };

const FLAG_LABEL: [keyof MediaFlags, string][] = [
  ['watermark', 'Watermark'], ['phone_visible', 'Contact info'], ['people_visible', 'People'], ['blurry', 'Blurry'], ['dark', 'Dark'], ['duplicate', 'Duplicate'], ['low_res', 'Too small'],
];
export const photoFlags = (f: MediaFlags) => FLAG_LABEL.filter(([k]) => f[k]).map(([, l]) => l);

const ROOM = (r: string | null) => (r ? r.replace(/_/g, ' ') : null);

/**
 * Thumbnails with reorder (drag on desktop, arrows on phones), cover star, remove and AI flags.
 * Removed photos stay visible, greyed out, with an undo.
 */
export function PhotoGrid({ items, onMove, onCover, onRemove, onRestore, busy }: {
  items: PhotoItem[];
  onMove: (from: number, to: number) => void;
  onCover: (id: string) => void;
  onRemove: (id: string) => void;
  onRestore?: (id: string) => void;
  busy?: boolean;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
      {items.map((p, i) => {
        const flags = photoFlags(p.flags ?? {});
        const src = p.url ?? p.localUrl;
        return (
          <li key={p.id} draggable={!p.removed && !p.uploading && !busy}
            onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag !== null && drag !== i) onMove(drag, i); setDrag(null); }}
            className={`group relative overflow-hidden rounded-xl border bg-panel-2 ${p.isCover ? 'border-brand ring-2 ring-brand/30' : 'border-line'} ${p.removed ? 'opacity-40' : ''} ${drag === i ? 'opacity-60' : ''}`}>
            <div className="aspect-[4/3]">
              {src
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL or local preview
                ? <img src={src} alt={ROOM(p.roomType) ?? p.fileName} className="h-full w-full object-cover" loading="lazy" />
                : <div className="grid h-full place-items-center px-2 text-center text-xs text-ink-3">{p.fileName}</div>}
            </div>
            {p.uploading !== undefined && p.uploading < 100 && (
              <div className="absolute inset-0 grid place-items-center bg-black/40 text-sm font-semibold text-white"><span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />{p.uploading}%</span></div>
            )}
            {p.error && <div className="absolute inset-0 grid place-items-center bg-bad/80 p-2 text-center text-xs font-medium text-white">{p.error}</div>}
            <div className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
              {p.isCover && <span className="rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">COVER</span>}
              {ROOM(p.roomType) && <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium capitalize text-white">{ROOM(p.roomType)}</span>}
            </div>
            {flags.length > 0 && !p.removed && (
              <div className="absolute bottom-10 left-1.5 right-1.5 flex flex-wrap gap-1">
                {flags.map((f) => <span key={f} className="inline-flex items-center gap-0.5 rounded-md bg-warn px-1.5 py-0.5 text-[10px] font-semibold text-white"><AlertTriangle size={10} />{f}</span>)}
              </div>
            )}
            {!p.error && (
              <div className="flex items-center justify-between gap-1 border-t border-line bg-panel px-1.5 py-1">
                {p.removed ? (
                  <button className="btn-ghost flex items-center gap-1 rounded-md px-1.5 py-1 text-xs" onClick={() => onRestore?.(p.id)}><RotateCcw size={13} />Undo</button>
                ) : (
                  <>
                    <span className="flex">
                      <button aria-label="Move left" disabled={i === 0 || busy} onClick={() => onMove(i, i - 1)} className="rounded-md p-1.5 text-ink-2 hover:bg-panel-2 disabled:opacity-30"><ArrowLeft size={14} /></button>
                      <button aria-label="Move right" disabled={i === items.length - 1 || busy} onClick={() => onMove(i, i + 1)} className="rounded-md p-1.5 text-ink-2 hover:bg-panel-2 disabled:opacity-30"><ArrowRight size={14} /></button>
                    </span>
                    <span className="flex">
                      <button aria-label="Set as cover" title="Set as cover" disabled={busy} onClick={() => onCover(p.id)} className={`rounded-md p-1.5 hover:bg-panel-2 ${p.isCover ? 'text-brand' : 'text-ink-2'}`}><Star size={14} fill={p.isCover ? 'currentColor' : 'none'} /></button>
                      <button aria-label="Remove photo" title="Remove" disabled={busy} onClick={() => onRemove(p.id)} className="rounded-md p-1.5 text-ink-2 hover:bg-panel-2 hover:text-bad"><Trash2 size={14} /></button>
                    </span>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

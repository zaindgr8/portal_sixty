'use client';
import { useState } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import { ENUM_FIELDS, NUMBER_FIELDS, DATE_FIELDS } from '@/lib/proptech/schema';
import { FIELD_LABEL } from '@/lib/proptech/validate';
import { EMIRATES, PROPERTY_TYPE_LABEL, SOURCE_LABEL, type Listing, type ListingField, type ListingMedia } from '@/lib/proptech/types';

const ENUM_LABEL: Record<string, string> = {
  sale: 'Sale', rent: 'Rent', residential: 'Residential', commercial: 'Commercial', ready: 'Ready', off_plan: 'Off-plan',
  furnished: 'Furnished', semi_furnished: 'Semi-furnished', unfurnished: 'Unfurnished', yearly: 'Per year', monthly: 'Per month', ...PROPERTY_TYPE_LABEL,
};
export const enumLabel = (v: string) => ENUM_LABEL[v] ?? v;

export const GROUPS: { key: string; title: string; fields: ListingField[] }[] = [
  { key: 'property', title: 'Property', fields: ['offering_type', 'category', 'property_type', 'completion_status', 'emirate', 'community', 'sub_community', 'building', 'unit_number', 'floor', 'bedrooms', 'bathrooms', 'size_sqft', 'plot_sqft'] },
  { key: 'price', title: 'Price', fields: ['price', 'price_type', 'cheques', 'service_charge', 'payment_plan'] },
  { key: 'contract', title: 'Contract', fields: ['form_a_number', 'form_a_expiry', 'developer', 'handover_date'] },
  { key: 'features', title: 'Features', fields: ['parking', 'furnishing', 'view', 'amenities'] },
];
/** Fields where we show the source snippet / page thumbnail for one-glance checking. */
export const LEGAL_VIEW = new Set<ListingField>(['unit_number', 'size_sqft', 'plot_sqft', 'price', 'form_a_number', 'form_a_expiry', 'community', 'building', 'property_type', 'bedrooms', 'developer', 'offering_type']);

export type Tint = 'missing' | 'low' | 'ok';
export function tintFor(l: Listing, f: ListingField, required: Set<string>): Tint {
  const v = l[f];
  const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  if (empty) return required.has(f) ? 'missing' : 'ok';
  const c = l.fieldConfidence[f];
  return c !== undefined && c < 0.8 ? 'low' : 'ok';
}
const TINT: Record<Tint, string> = {
  missing: 'border-bad/60 bg-bad-soft/40', low: 'border-warn/60 bg-warn-soft/50', ok: '',
};

/** One editable field with its confidence colour and where the value came from. */
export function FieldRow({ l, f, required, media, onSave, disabled }: {
  l: Listing; f: ListingField; required: Set<string>; media: ListingMedia[]; onSave: (f: ListingField, v: unknown) => void; disabled?: boolean;
}) {
  const value = l[f];
  const [draft, setDraft] = useState(fmt(value));
  // When the saved value changes (AI, chip answer, another save), show it.
  const [seen, setSeen] = useState(fmt(value));
  if (seen !== fmt(value)) { setSeen(fmt(value)); setDraft(fmt(value)); }
  const tint = tintFor(l, f, required);
  const src = l.fieldSource[f];
  const conf = l.fieldConfidence[f];
  const id = `field-${f}`;
  const save = (v: string) => { if (v !== fmt(value)) onSave(f, f === 'amenities' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v); };
  const opts = f === 'emirate' ? (EMIRATES as readonly string[]) : ENUM_FIELDS[f];
  const doc = src?.mediaId ? media.find((m) => m.id === src.mediaId) : src?.source === 'form_a' ? media.find((m) => m.kind === 'form_a') : undefined;
  const label = FIELD_LABEL[f] ?? f;

  return (
    <div id={id} className={`scroll-mt-24 rounded-xl border border-transparent p-2 ${TINT[tint]}`}>
      <label htmlFor={`${id}-input`} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-2">
        {label}{required.has(f) && <span className="text-bad">*</span>}
        {tint === 'missing' && <span className="ml-auto text-[11px] font-semibold text-bad">Missing</span>}
        {tint === 'low' && <span className="ml-auto text-[11px] font-semibold text-warn">Check · {Math.round((conf ?? 0) * 100)}%</span>}
      </label>
      {opts ? (
        <select id={`${id}-input`} className="input" disabled={disabled} value={draft} onChange={(e) => { setDraft(e.target.value); save(e.target.value); }}>
          <option value="">—</option>
          {opts.map((o) => <option key={o} value={o}>{enumLabel(o)}</option>)}
        </select>
      ) : f === 'payment_plan' ? (
        <textarea id={`${id}-input`} className="input min-h-[60px]" disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={(e) => save(e.target.value)} />
      ) : (
        <input id={`${id}-input`} className="input" disabled={disabled}
          type={DATE_FIELDS.has(f) ? 'date' : NUMBER_FIELDS.has(f) ? 'number' : 'text'} inputMode={NUMBER_FIELDS.has(f) ? 'decimal' : undefined}
          placeholder={f === 'amenities' ? 'Comma separated, e.g. Pool, Gym, Maid\'s room' : f === 'bedrooms' ? '0 = studio' : undefined}
          value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={(e) => save(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      )}
      {src && src.source !== 'agent' && (
        <div className="mt-1 flex items-start gap-1.5 text-[11px] text-ink-3">
          {src.source === 'inferred' ? <Sparkles size={11} className="mt-0.5 shrink-0" /> : <FileText size={11} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 flex-1">
            {SOURCE_LABEL[src.source]}{src.page ? `, page ${src.page}` : ''}
            {LEGAL_VIEW.has(f) && src.snippet && <span className="block truncate italic text-ink-2">“{src.snippet}”</span>}
          </span>
          {LEGAL_VIEW.has(f) && doc?.url && (
            <a href={doc.mimeType === 'application/pdf' ? `${doc.url}#page=${src.page ?? 1}` : doc.url} target="_blank" rel="noreferrer" title="Open the page this came from" className="shrink-0">
              {doc.mimeType.startsWith('image/') && !/heic/.test(doc.mimeType)
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                ? <img src={doc.url} alt="Source page" className="h-10 w-8 rounded border border-line object-cover" />
                : <span className="inline-flex h-10 w-8 items-center justify-center rounded border border-line bg-panel text-[9px] font-semibold text-ink-2">PDF{src.page ? ` p${src.page}` : ''}</span>}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

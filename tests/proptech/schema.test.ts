import { describe, expect, it } from 'vitest';
import { coerceValue, copySchema, extractionSchema, photoAnalysisSchema, toIsoDate, voiceSchema } from '@/lib/proptech/schema';
import { mergeFields } from '@/lib/proptech/merge';
import { assembleCopy, fitTitle } from '@/lib/proptech/copy';

describe('extraction schema parsing', () => {
  it('accepts a good Gemini answer', () => {
    const r = extractionSchema.parse({
      document_kind: 'form_a',
      fields: [
        { field: 'unit_number', value: '2304', confidence: 0.97, source: 'form_a', page: 1, snippet: 'Unit No: 2304' },
        { field: 'size_sqft', value: '1,350', confidence: 0.9, source: 'form_a' },
      ],
      amenities: ['Pool'],
      owner: { name: 'Jane Doe', phone: '+971501234567' },
    });
    expect(r.fields).toHaveLength(2);
    expect(r.owner.name).toBe('Jane Doe');
  });

  it('drops malformed entries instead of failing the whole draft', () => {
    const r = extractionSchema.parse({
      document_kind: 'form_a',
      fields: [
        { field: 'unit_number', value: '2304', confidence: 0.97, source: 'form_a' },
        { field: 'not_a_field', value: 'x', confidence: 1, source: 'form_a' },
        { value: 'missing field name' },
        'garbage',
      ],
    });
    expect(r.fields.map((f) => f.field)).toEqual(['unit_number']);
  });

  it('clamps confidence and fixes unknown sources', () => {
    const r = extractionSchema.parse({ document_kind: 'other', fields: [{ field: 'price', value: '100', confidence: 7, source: 'magic' }] });
    expect(r.fields[0].confidence).toBe(1);
    expect(r.fields[0].source).toBe('inferred');
  });

  it('survives a completely wrong shape', () => {
    const r = extractionSchema.parse({ fields: 'nope', document_kind: 42, owner: 'x' });
    expect(r.fields).toEqual([]);
    expect(r.document_kind).toBe('other');
    expect(r.owner).toEqual({});
  });

  it('parses photo analysis and voice answers leniently', () => {
    const p = photoAnalysisSchema.parse({ photos: [{ index: 0, room_type: 'spaceship', quality: 0.9, blurry: false, dark: false, duplicate_of: -1, watermark: true, phone_visible: false, people_visible: false }], suggested_order: [0], cover_index: 0 });
    expect(p.photos[0].room_type).toBe('other');
    expect(p.photos[0].watermark).toBe(true);
    const v = voiceSchema.parse({ transcript: 'Full sea view, vacant', facts: [{ field: 'view', value: 'Sea view', confidence: 0.9, source: 'voice' }] });
    expect(v.facts[0].field).toBe('view');
  });

  it('rejects copy that is missing parts (so the call is retried)', () => {
    expect(copySchema.safeParse({ title: 'x' }).success).toBe(false);
  });
});

describe('value coercion', () => {
  it('reads numbers, studios, millions and enums', () => {
    expect(coerceValue('size_sqft', '1,350 sq.ft')).toBe(1350);
    expect(coerceValue('bedrooms', 'Studio')).toBe(0);
    expect(coerceValue('price', 'AED 3.2M')).toBe(3_200_000);
    expect(coerceValue('offering_type', 'Rental')).toBe('rent');
    expect(coerceValue('completion_status', 'Off Plan')).toBe('off_plan');
    expect(coerceValue('furnishing', 'banana')).toBeUndefined();
    expect(coerceValue('unit_number', 'N/A')).toBeUndefined();
  });
  it('reads UAE day-first dates', () => {
    expect(toIsoDate('31/12/2026')).toBe('2026-12-31');
    expect(toIsoDate('2026-12-31')).toBe('2026-12-31');
    expect(toIsoDate('31/02/2026')).toBeUndefined();
  });
});

describe('merge rules', () => {
  it('documents win legal fields, notes/voice win marketing fields', () => {
    const m = mergeFields([
      { field: 'size_sqft', value: '1350', confidence: 0.95, source: 'form_a' },
      { field: 'size_sqft', value: '1400', confidence: 0.9, source: 'voice' },
      { field: 'view', value: 'Partial marina view', confidence: 0.9, source: 'form_a' },
      { field: 'view', value: 'Full marina view', confidence: 0.85, source: 'voice' },
    ]);
    expect(m.values.size_sqft).toBe(1350);
    expect(m.values.view).toBe('Full marina view');
    expect(m.source.view?.source).toBe('voice');
    // A disagreement on a legal field lowers confidence so the agent checks it.
    expect(m.confidence.size_sqft).toBeLessThan(0.8);
    expect(m.conflicts[0]).toMatchObject({ field: 'size_sqft', kept: '1350', other: '1400' });
  });
  it('caps inferred values and derives safe fields', () => {
    const m = mergeFields([
      { field: 'property_type', value: 'apartment', confidence: 0.99, source: 'inferred' },
      { field: 'offering_type', value: 'sale', confidence: 0.95, source: 'form_a' },
      { field: 'community', value: 'JVC', confidence: 0.9, source: 'form_a' },
    ]);
    expect(m.confidence.property_type).toBe(0.6);
    expect(m.values.category).toBe('residential');
    expect(m.values.price_type).toBe('sale');
    expect(m.values.emirate).toBe('Dubai');
  });
});

describe('copy assembly', () => {
  it('builds bullets, strips contact details and emoji, keeps the title within 50', () => {
    const c = assembleCopy({
      title: '2BR Apartment | Stunning Full Marina And Sea Views | Dubai Marina',
      hook: 'Wake up to the marina. Call 050 123 4567 now 🔥',
      highlights: ['Full marina view', '- Two parking spaces'],
      body: 'Email sales@agency.ae or visit www.agency.ae for more.',
    });
    expect(c.title.length).toBeLessThanOrEqual(50);
    expect(c.title).toContain('Dubai Marina');
    expect(c.description).toContain('• Two parking spaces');
    expect(c.description).not.toMatch(/050|@|www\.|🔥/);
  });
  it('fitTitle never exceeds the limit', () => {
    for (const t of ['Villa | x'.repeat(20), 'A very long single title with no separators at all in it ever']) expect(fitTitle(t).length).toBeLessThanOrEqual(50);
  });
});

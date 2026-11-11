import { describe, expect, it } from 'vitest';
import { copyProblems, permitReady, validateListing } from '@/lib/proptech/validate';
import { missingQuestions } from '@/lib/proptech/questions';
import { listing, photos } from './fixtures';

const today = new Date('2026-11-10T08:00:00Z');
const errors = (r: ReturnType<typeof validateListing>) => r.issues.filter((i) => i.level === 'error');

describe('validation before publish', () => {
  it('passes a complete listing', () => {
    const r = validateListing({ listing: listing(), media: photos(8), today });
    expect(errors(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('blocks publishing without a permit, and with an expired one', () => {
    const none = validateListing({ listing: listing({ permit_number: null, permit_expiry: null }), media: photos(8), today });
    expect(none.ok).toBe(false);
    expect(errors(none).map((i) => i.field)).toEqual(expect.arrayContaining(['permit_number', 'permit_expiry']));
    const expired = validateListing({ listing: listing({ permit_expiry: '2026-11-10' }), media: photos(8), today });
    expect(errors(expired).some((i) => i.field === 'permit_expiry')).toBe(true);
    expect(permitReady(listing({ permit_expiry: '2026-11-11' }), today)).toBe(true);
    expect(permitReady(listing({ permit_expiry: '2026-11-10' }), today)).toBe(false);
  });

  it('requires beds/baths for residential only, BRN and ORN always', () => {
    const r = validateListing({ listing: listing({ bedrooms: null, bathrooms: null, agent_brn: null, agency_orn: null }), media: photos(8), today });
    expect(errors(r).map((i) => i.field)).toEqual(expect.arrayContaining(['bedrooms', 'bathrooms', 'agent_brn', 'agency_orn']));
    const office = validateListing({ listing: listing({ category: 'commercial', property_type: 'office', bedrooms: null, bathrooms: null }), media: photos(8), today });
    expect(errors(office).some((i) => i.field === 'bedrooms')).toBe(false);
  });

  it('blocks an expired Form A', () => {
    const r = validateListing({ listing: listing({ form_a_expiry: '2026-01-01' }), media: photos(8), today });
    expect(errors(r).some((i) => i.field === 'form_a_expiry')).toBe(true);
  });

  it('asks to confirm suspicious prices', () => {
    const cheap = validateListing({ listing: listing({ price: 50_000 }), media: photos(8), today });
    expect(cheap.issues.some((i) => i.level === 'confirm' && i.field === 'price')).toBe(true);
    expect(cheap.ok).toBe(true); // a confirmation, not an error
    const rent = validateListing({ listing: listing({ offering_type: 'rent', price_type: 'yearly', price: 6_000_000 }), media: photos(8), today });
    expect(rent.issues.some((i) => i.level === 'confirm')).toBe(true);
  });

  it('checks the copy: length and no contact details or emoji', () => {
    const long = validateListing({ listing: listing({ title_en: 'x'.repeat(51) }), media: photos(8), today });
    expect(errors(long).some((i) => i.field === 'title_en')).toBe(true);
    const short = validateListing({ listing: listing({ description_en: 'Too short.' }), media: photos(8), today });
    expect(errors(short).some((i) => i.field === 'description_en')).toBe(true);
    expect(copyProblems('Call +971 50 123 4567')).toContain('a phone number');
    expect(copyProblems('Call 0501234567')).toContain('a phone number');
    expect(copyProblems('mail me: a@b.com')).toContain('an email address');
    expect(copyProblems('see www.example.com')).toContain('a web address');
    expect(copyProblems('Lovely 🌊')).toContain('emoji');
    expect(copyProblems('1,350 sqft with 2 parking spaces, AED 3,200,000')).toEqual([]);
  });

  it('checks photos: at least 5, 800px short side, clean cover', () => {
    expect(errors(validateListing({ listing: listing(), media: photos(4), today })).some((i) => i.field === 'photos')).toBe(true);
    expect(errors(validateListing({ listing: listing(), media: photos(6, { width: 700, height: 500 }), today })).some((i) => i.field === 'photos')).toBe(true);
    const dirty = photos(6);
    dirty[0].flags = { watermark: true };
    expect(errors(validateListing({ listing: listing(), media: dirty, today })).some((i) => i.field === 'cover')).toBe(true);
    const removed = photos(7).map((p, i) => ({ ...p, removed: i < 3 }));
    expect(errors(validateListing({ listing: listing(), media: removed, today })).some((i) => i.field === 'photos')).toBe(true);
  });

  it('applies portal rules from the mapping files', () => {
    const r = validateListing({ listing: listing(), media: photos(8), portals: ['bayut'], rules: { bayut: { requireArabic: true } }, today });
    expect(errors(r).some((i) => i.portal === 'bayut')).toBe(true);
  });
});

describe('AI asks chips', () => {
  it('asks only for missing required fields, with quick answers', () => {
    const q = missingQuestions(listing({ parking: null, bathrooms: null, permit_number: null }));
    const fields = q.map((x) => x.field);
    expect(fields).toEqual(expect.arrayContaining(['parking', 'bathrooms']));
    expect(fields).not.toContain('permit_number'); // the permit has its own block
    expect(fields).not.toContain('bedrooms'); // already filled
    expect(q.find((x) => x.field === 'parking')?.options).toEqual(['0', '1', '2', '3+']);
  });
});

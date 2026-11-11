import { describe, expect, it } from 'vitest';
import { manualSheet, isManual } from '@/lib/proptech/manual';
import { crc32, zipStore } from '@/lib/proptech/zip';
import { listing } from './fixtures';

describe('copy & paste posting', () => {
  it('lists the fields in portal order with portal wording, and skips empty ones', () => {
    const pf = manualSheet(listing({ offering_type: 'rent', price_type: 'yearly', cheques: 4, plot_sqft: null }), 'propertyfinder', { name: 'Ali', phone: '+971500000000' });
    expect(pf[0]).toMatchObject({ label: 'Offering type', value: 'Rent' });
    expect(pf.find((r) => r.key === 'period')?.value).toBe('Yearly');
    expect(pf.find((r) => r.key === 'plot')).toBeUndefined();
    expect(pf.find((r) => r.key === 'agent')?.value).toContain('Ali');
    const bayut = manualSheet(listing(), 'bayut');
    expect(bayut[0]).toMatchObject({ label: 'Purpose', value: 'Buy' });
    expect(bayut.find((r) => r.key === 'permit')?.value).toBe('7123456789');
    expect(bayut.find((r) => r.key === 'location')?.value).toBe('Dubai › Dubai Marina › Marina Gate 1');
  });
  it('never includes owner data or the unit number', () => {
    const withOwner = { ...listing(), owner_pii: 'v1:secret', owner: { name: 'Jane Owner', phone: '+971509999999' } } as unknown as ReturnType<typeof listing>;
    const text = manualSheet(withOwner, 'bayut').map((r) => r.value).join(' ');
    expect(text).not.toContain('2304');
    expect(text).not.toMatch(/Jane Owner|509999999|v1:secret/);
  });
  it('recognises hand-posted portal rows', () => {
    expect(isManual('manual:https://x')).toBe(true);
    expect(isManual('PF-123')).toBe(false);
    expect(isManual(null)).toBe(false);
  });
});

describe('photo zip', () => {
  it('computes CRC32 correctly and writes a valid zip structure', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const zip = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'b.txt', data: new Uint8Array([1, 2, 3]) }]);
    const dv = new DataView(zip.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
  });
});

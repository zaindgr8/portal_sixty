import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFeedXml, checkXml, feedEligible, type FeedMapping } from '@/lib/proptech/adapters/feed';
import { listing, photos } from './fixtures';

const mapping = JSON.parse(readFileSync(path.join(__dirname, '../../mappings/bayut.json'), 'utf8')) as FeedMapping;
const ctx = { mapping, defaults: { orn: '12345' }, imageUrl: (m: { id: string }) => `https://portal.example/feeds/bayut/a/t/media/${m.id}`, today: new Date('2026-11-10') };

describe('Bayut feed generation', () => {
  it('includes only valid listings with a valid permit', () => {
    const good = { listing: listing(), media: photos(6) };
    const noPermit = { listing: listing({ id: '22222222-2222-4222-8222-222222222222', permit_number: null }), media: photos(6) };
    const expired = { listing: listing({ id: '33333333-3333-4333-8333-333333333333', permit_expiry: '2020-01-01' }), media: photos(6) };
    const fewPhotos = { listing: listing({ id: '44444444-4444-4444-8444-444444444444' }), media: photos(2) };
    const { ok, skipped } = feedEligible([good, noPermit, expired, fewPhotos], ctx);
    expect(ok.map((x) => x.listing.id)).toEqual([good.listing.id]);
    expect(skipped).toHaveLength(3);
    const xml = buildFeedXml(ok, ctx);
    expect(checkXml(xml)).toBeNull();
    expect(xml).toContain(`<Property_Ref_No>${good.listing.id}</Property_Ref_No>`);
    expect(xml).not.toContain('22222222-2222');
  });

  it('maps values, lists photos cover-first and escapes text', () => {
    const l = listing({ building: 'Tower <A> & "B"', amenities: ['Pool', 'Maid\'s room'] });
    const media = photos(6).map((p, i) => ({ ...p, isCover: i === 3 }));
    const xml = buildFeedXml([{ listing: l, media }], ctx);
    expect(checkXml(xml)).toBeNull();
    expect(xml).toContain('<Property_purpose>Buy</Property_purpose>');
    expect(xml).toContain('<Off_Plan>No</Off_Plan>');
    expect(xml).toContain('<Tower_Name>Tower &lt;A&gt; &amp; &quot;B&quot;</Tower_Name>');
    expect(xml).toContain('<Agency_ORN>12345</Agency_ORN>');
    const imgs = [...xml.matchAll(/<Image>([^<]+)<\/Image>/g)].map((m) => m[1]);
    expect(imgs[0]).toContain(media[3].id);
    expect(imgs).toHaveLength(6);
  });

  it('supports off-plan fields', () => {
    const xml = buildFeedXml([{ listing: listing({ completion_status: 'off_plan', handover_date: '2028-03-31', payment_plan: '60/40' }), media: photos(6) }], ctx);
    expect(xml).toContain('<Off_Plan>Yes</Off_Plan>');
    expect(xml).toContain('<Handover_Date>2028-03-31</Handover_Date>');
    expect(xml).toContain('<Payment_Plan>60/40</Payment_Plan>');
  });

  it('never contains owner data, even if a row carries it', () => {
    const withOwner = { ...listing(), owner_pii: 'v1:secret', owner: { name: 'Jane Owner', phone: '+971509999999' } } as unknown as ReturnType<typeof listing>;
    const xml = buildFeedXml([{ listing: withOwner, media: photos(6) }], ctx);
    expect(xml).not.toMatch(/Jane Owner|509999999|v1:secret|owner_pii/);
  });

  it('refuses a mapping with unsafe element names', () => {
    expect(() => buildFeedXml([{ listing: listing(), media: photos(6) }], { ...ctx, mapping: { ...mapping, fields: { 'bad name><x': 'ref' } } })).toThrow();
  });

  it('detects broken XML so the last good feed is served instead', () => {
    expect(checkXml('<?xml version="1.0"?><Properties><Property></Properties>')).not.toBeNull();
    expect(checkXml('<A></A><B></B>')).not.toBeNull();
    expect(checkXml('<A><![CDATA[ <not a tag> ]]></A>')).toBeNull();
  });
});

import type { Listing, ListingMedia } from '@/lib/proptech/types';

export const LONG_DESC_EN =
  'Bright two-bedroom apartment with a full marina view, set on a high floor of a well-kept tower in the heart of Dubai Marina.\n\n' +
  '• Full marina view from the living room and master bedroom\n• Upgraded kitchen with built-in appliances\n• Two covered parking spaces\n' +
  '• Large balcony with space for dining\n• Vacant and ready to move in\n• Walking distance to the tram and the marina walk\n\n' +
  'Dubai Marina is one of the most popular waterfront communities in the city, with restaurants, shops and the beach a few minutes away. ' +
  'The building offers a pool, gym and 24-hour security, and the unit has been kept in excellent condition by the current owner. ' +
  'It suits a family looking for space and views, or an investor looking for a unit that rents quickly in a high-demand area. ' +
  'Contact us today to arrange a viewing at a time that suits you.';

export function listing(over: Partial<Listing> = {}): Listing {
  return {
    id: '11111111-1111-4111-8111-111111111111', workspaceId: 'agency-a', createdBy: 'ali', agentId: 'ali', status: 'approved',
    offering_type: 'sale', category: 'residential', property_type: 'apartment', completion_status: 'ready', emirate: 'Dubai',
    community: 'Dubai Marina', sub_community: null, building: 'Marina Gate 1', unit_number: '2304', bedrooms: 2, bathrooms: 3,
    size_sqft: 1350, plot_sqft: null, parking: 2, furnishing: 'unfurnished', view: 'Full marina view', floor: '23', amenities: ['Pool', 'Gym'],
    price: 3_200_000, price_type: 'sale', cheques: null, service_charge: 22, developer: 'Select Group', handover_date: null, payment_plan: null,
    permit_number: '7123456789', permit_expiry: '2099-01-01', agency_orn: '12345', agent_brn: '54321', form_a_number: 'FA-2026-001',
    form_a_expiry: '2099-06-01', title_en: '2BR Apartment | Full Marina View | Dubai Marina', title_ar: null,
    description_en: LONG_DESC_EN, description_ar: null, tone: 'professional', fieldConfidence: {}, fieldSource: {}, aiQuestions: [], progress: {},
    aiCostUsd: 0, aiTokens: 0, approvedAt: null, approvedBy: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
    ...over,
  };
}

export function photos(n: number, over: Partial<ListingMedia> = {}): ListingMedia[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, kind: 'photo' as const, docType: null, fileName: `p${i}.jpg`, mimeType: 'image/jpeg',
    sizeBytes: 100_000, width: 2000, height: 1333, roomType: 'living_room', order: i, isCover: i === 0, removed: false, flags: {}, ...over,
  }));
}

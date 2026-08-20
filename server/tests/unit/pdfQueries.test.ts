import { describe, it, expect } from 'vitest';
import { computePdfContentHash } from '../../src/pdf/pdfQueries.js';

const base = {
  langCode: 'am',
  title: 'ትንሳኤ',
  authorName: 'አባ ጳውሎስ',
  publishedAt: new Date('2026-08-20T10:00:00.000Z'),
  categoryName: 'ኦርቶዶክሳዊ ትምህርት',
  summary: 'ጥቅም',
  body: '<p>ሰላም</p>',
};

describe('computePdfContentHash', () => {
  it('is deterministic for identical rendered fields', () => {
    expect(computePdfContentHash(base)).toBe(computePdfContentHash({ ...base }));
  });

  it('normalizes publishedAt (Date vs ISO string) to the same hash', () => {
    const asDate = computePdfContentHash(base);
    const asIso = computePdfContentHash({ ...base, publishedAt: '2026-08-20T10:00:00.000Z' });
    expect(asIso).toBe(asDate);
  });

  it('changes when authorName changes (PDF renders the author)', () => {
    expect(computePdfContentHash({ ...base, authorName: 'አባ ሙሉጌታ' })).not.toBe(computePdfContentHash(base));
  });

  it('changes when publishedAt changes (PDF renders the date)', () => {
    expect(computePdfContentHash({ ...base, publishedAt: new Date('2026-08-21T10:00:00.000Z') })).not.toBe(
      computePdfContentHash(base)
    );
  });

  it('changes when categoryName, summary, body, title, or langCode changes', () => {
    const original = computePdfContentHash(base);
    expect(computePdfContentHash({ ...base, categoryName: 'ሌላ' })).not.toBe(original);
    expect(computePdfContentHash({ ...base, summary: 'የተለየ' })).not.toBe(original);
    expect(computePdfContentHash({ ...base, body: '<p>ሌላ</p>' })).not.toBe(original);
    expect(computePdfContentHash({ ...base, title: 'ሌላ ርዕስ' })).not.toBe(original);
    expect(computePdfContentHash({ ...base, langCode: 'en' })).not.toBe(original);
  });

  it('ignores non-rendered fields entirely (slug is not part of the hash)', () => {
    const withSlug = { ...base, slug: 'whatever' };
    expect(computePdfContentHash(withSlug as any)).toBe(computePdfContentHash(base));
  });
});
import { aspectFor, disclosureText, isUnavailable, offerA11yLabel, urgencyLabel, verifiedDiscount } from '@/components/offers/presentation';
import { buildSampleOffers } from '@/data/sampleOffers';
import { CATEGORIES } from '@/data/categories';
import { artColors, mix, palettes, pickArtBase, vividness, type Palette } from '@/theme/tokens';
import type { Offer } from '@/types/offer';

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const NOW = new Date('2026-11-15T12:00:00Z');
const offers = buildSampleOffers(NOW);
const base: Offer = { ...offers[0], price: undefined, originalPrice: undefined, promoLabel: undefined, expiresAt: undefined, sponsored: false, affiliate: false, demo: false, source: 'direct' };

describe('design tokens: WCAG AA contrast (4.5:1) in light and dark', () => {
  const TEXT: (keyof Palette)[] = ['text', 'textSecondary', 'textTertiary', 'accentText', 'danger', 'success'];
  for (const scheme of ['light', 'dark'] as const) {
    const p = palettes[scheme];
    for (const fg of TEXT) {
      for (const bg of ['canvas', 'surface', 'fill'] as (keyof Palette)[]) {
        it(`${scheme}: ${fg} on ${bg}`, () => expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5));
      }
    }
    it(`${scheme}: primary button text on ink`, () => expect(contrast(p.onInk, p.ink)).toBeGreaterThanOrEqual(4.5));
    it(`${scheme}: white on sale badge`, () => expect(contrast('#FFFFFF', p.sale)).toBeGreaterThanOrEqual(4.5));
    it(`${scheme}: warning text on warning tint`, () => expect(contrast(p.warning, p.warningSoft)).toBeGreaterThanOrEqual(4.5));
    it(`${scheme}: danger text on danger tint`, () => expect(contrast(p.danger, p.dangerSoft)).toBeGreaterThanOrEqual(4.5));
  }
  it('category tile glyphs are distinguishable from their backdrop (3:1 for graphics) in both schemes', () => {
    for (const c of CATEGORIES) {
      for (const scheme of ['light', 'dark'] as const) {
        const a = artColors(c.colors[0], scheme);
        expect(contrast(a.glyph, a.backdrop)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('color utilities', () => {
  it('mixes colors', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
  it('avoids gray art: near-black ad colors fall back to the category color', () => {
    expect(pickArtBase(['#232526', '#414345'], '#5B5BD6')).toBe('#5B5BD6');
    expect(pickArtBase(['#0F2027', '#E8663A'], '#000000')).toBe('#E8663A');
    expect(vividness('#FF0000')).toBeCloseTo(1);
  });
});

describe('card presentation rules: never show a claim the data cannot back up', () => {
  it('discount badge only for a real, lower price in the same currency', () => {
    expect(verifiedDiscount({ ...base, price: { amount: 58, currency: 'USD' }, originalPrice: { amount: 90, currency: 'USD' } })).toBe('−36%');
    expect(verifiedDiscount({ ...base, price: { amount: 58, currency: 'USD' } })).toBeUndefined();
    expect(verifiedDiscount({ ...base, promoLabel: '50% off everything' })).toBeUndefined();
    expect(verifiedDiscount({ ...base, price: { amount: 98, currency: 'USD' }, originalPrice: { amount: 100, currency: 'USD' } })).toBeUndefined(); // < 5% is noise
  });
  it('urgency badge only when a real expiry is within 48h', () => {
    const at = (h: number) => ({ ...base, expiresAt: new Date(NOW.getTime() + h * 3600_000).toISOString() });
    expect(urgencyLabel(at(5), NOW)).toBe('Ends in 5h');
    expect(urgencyLabel(at(30), NOW)).toBe('Ends tomorrow');
    expect(urgencyLabel(at(0.5), NOW)).toBe('Ends in <1h');
    expect(urgencyLabel(at(72), NOW)).toBeUndefined();
    expect(urgencyLabel(base, NOW)).toBeUndefined();
    expect(isUnavailable(at(-1), NOW)).toBe(true);
  });
  it('always names paid placement and demo content', () => {
    expect(disclosureText({ ...base, sponsored: true })).toBe('Sponsored');
    expect(disclosureText({ ...base, sponsored: true, demo: true })).toBe('Sponsored · Demo');
    expect(disclosureText(base)).toBeUndefined();
  });
  it('uses format-appropriate aspect ratios', () => {
    expect(aspectFor({ ...base, kind: 'product' })).toBeGreaterThan(aspectFor({ ...base, kind: 'local' }));
  });
  it('screen reader label follows the visual hierarchy and includes disclosures', () => {
    const label = offerA11yLabel({ ...base, title: 'Court Classic', price: { amount: 58, currency: 'USD' }, originalPrice: { amount: 90, currency: 'USD' }, sponsored: true, affiliate: true }, NOW);
    expect(label).toBe('Court Classic. $58, was $90. 36% off. from ' + base.advertiser.name + '. Sponsored. Affiliate link');
  });
});

import {
  calculateQuotationTotals,
  quotationLineNetAmount,
} from './quotation-totals.util';

describe('calculateQuotationTotals', () => {
  it('rounds each line to 2 decimals before summing', () => {
    const totals = calculateQuotationTotals([
      { price: 0.1, quantity: 3 },
      { price: 0.2, quantity: 3 },
    ]);
    expect(totals.subtotal).toBe(0.9);
    expect(totals.total).toBe(0.9);
  });

  it('applies per-line discounts before the quotation percentage', () => {
    const totals = calculateQuotationTotals(
      [
        { price: 100, quantity: 2, lineDiscount: 20 },
        { price: 50, quantity: 1 },
      ],
      10,
      0,
    );
    expect(totals.subtotal).toBe(250);
    expect(totals.lineDiscountTotal).toBe(20);
    expect(totals.netSubtotal).toBe(230);
    expect(totals.percentageDiscount).toBe(23);
    expect(totals.total).toBe(207);
  });

  it('caps the fixed discount at what remains', () => {
    const totals = calculateQuotationTotals([{ price: 100, quantity: 1 }], 10, 500);
    expect(totals.percentageDiscount).toBe(10);
    expect(totals.fixedDiscount).toBe(90);
    expect(totals.total).toBe(0);
  });

  it('never lets a line discount exceed the line amount', () => {
    const totals = calculateQuotationTotals(
      [{ price: 10, quantity: 1, lineDiscount: 999 }],
      0,
      0,
    );
    expect(totals.lineDiscountTotal).toBe(10);
    expect(totals.total).toBe(0);
  });

  it('clamps the percentage to 0..100 and handles empty input', () => {
    expect(calculateQuotationTotals([], 20, 10)).toEqual({
      subtotal: 0,
      lineDiscountTotal: 0,
      netSubtotal: 0,
      percentageDiscount: 0,
      fixedDiscount: 0,
      total: 0,
    });
    const totals = calculateQuotationTotals([{ price: 100, quantity: 1 }], 140, 0);
    expect(totals.percentageDiscount).toBe(100);
    expect(totals.total).toBe(0);
  });
});

describe('quotationLineNetAmount', () => {
  it('returns the rounded line amount after its discount', () => {
    expect(quotationLineNetAmount({ price: 19.99, quantity: 3, lineDiscount: 5 })).toBe(54.97);
  });
});

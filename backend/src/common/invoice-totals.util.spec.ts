import {
  calculateInvoiceDiscountFactor,
  calculateInvoiceTotals,
  calculateOutstandingInvoiceTotal,
  roundMoney,
} from './invoice-totals.util';

describe('invoice-totals.util', () => {
  it('rounds money to two decimals without introducing float drift', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(450 * 3 * 0.9)).toBe(1215);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(Number.NaN)).toBe(0);
  });

  it('applies percentage before fixed discount and never goes negative', () => {
    expect(calculateInvoiceTotals([{ price: 100, quantity: 2 }], 10, 50)).toEqual({
      subtotal: 200,
      percentageDiscount: 20,
      fixedDiscount: 50,
      total: 130,
    });

    expect(calculateInvoiceTotals([{ price: 100, quantity: 1 }], 50, 80).total).toBe(0);
  });

  it('derives a stable discount factor from the original terms', () => {
    expect(calculateInvoiceDiscountFactor(200, 10, 0)).toBe(0.9);
    expect(calculateInvoiceDiscountFactor(100, 0, 25)).toBe(0.75);
    // No original value: added lines are worth their full price.
    expect(calculateInvoiceDiscountFactor(0, 10, 0)).toBe(1);
  });

  it('values only the outstanding quantity, with the discount allocated per line', () => {
    const { subtotal, total } = calculateOutstandingInvoiceTotal(
      [
        { price: 450, quantity: 2 },
        { price: 100, quantity: 1 },
      ],
      0.9,
    );

    expect(subtotal).toBe(1000);
    expect(total).toBe(900);
  });
});

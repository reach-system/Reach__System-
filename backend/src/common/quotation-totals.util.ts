/**
 * Single source of truth for quotation money math on the server.
 *
 * Quotations are not financial documents, but the totals the customer sees
 * must still be deterministic and identical to what the frontend previews.
 * Every monetary figure is rounded to 2 decimals; client-supplied totals are
 * never accepted.
 *
 * Order of operations:
 *   1. each line: price × quantity, rounded, then its line discount capped at
 *      the line amount
 *   2. subtotal = sum of gross line amounts
 *   3. quotation percentage discount applied to the net subtotal
 *      (subtotal − line discounts)
 *   4. fixed discount capped by what remains
 *   5. total floored at 0
 */

import { roundMoney } from './invoice-totals.util';

export interface QuotationAmountLine {
  price: number;
  quantity: number;
  /** Absolute amount discounted on this line (currency, not percentage). */
  lineDiscount?: number;
}

export interface QuotationTotals {
  /** Gross line amounts before any discount. */
  subtotal: number;
  /** Sum of the per-line discounts actually applied. */
  lineDiscountTotal: number;
  /** subtotal − lineDiscountTotal. */
  netSubtotal: number;
  percentageDiscount: number;
  /** Fixed discount actually applied after the percentage discount. */
  fixedDiscount: number;
  total: number;
}

export function calculateQuotationTotals(
  items: QuotationAmountLine[],
  discountPercentage = 0,
  discountAmount = 0,
): QuotationTotals {
  let subtotal = 0;
  let lineDiscountTotal = 0;

  for (const item of items ?? []) {
    const quantity = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
    const price = Number.isFinite(item.price) ? Math.max(0, item.price) : 0;
    const lineAmount = roundMoney(price * quantity);
    const lineDiscount = roundMoney(
      Math.min(Math.max(0, Number(item.lineDiscount) || 0), lineAmount),
    );

    subtotal = roundMoney(subtotal + lineAmount);
    lineDiscountTotal = roundMoney(lineDiscountTotal + lineDiscount);
  }

  const netSubtotal = roundMoney(Math.max(0, subtotal - lineDiscountTotal));
  const safePercentage = Math.max(0, Math.min(Number(discountPercentage) || 0, 100));
  const percentageDiscount = roundMoney(netSubtotal * (safePercentage / 100));
  const fixedDiscount = roundMoney(
    Math.min(Math.max(0, Number(discountAmount) || 0), Math.max(0, netSubtotal - percentageDiscount)),
  );
  const total = roundMoney(Math.max(0, netSubtotal - percentageDiscount - fixedDiscount));

  return { subtotal, lineDiscountTotal, netSubtotal, percentageDiscount, fixedDiscount, total };
}

/** Line amount after its own line discount (used by documents and reports). */
export function quotationLineNetAmount(line: QuotationAmountLine): number {
  const gross = roundMoney(Math.max(0, line.price) * Math.max(0, line.quantity));
  const discount = Math.min(Math.max(0, Number(line.lineDiscount) || 0), gross);
  return roundMoney(gross - discount);
}

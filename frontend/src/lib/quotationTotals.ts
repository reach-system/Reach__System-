/**
 * Quotation money math for the UI.
 *
 * Mirrors backend/src/common/quotation-totals.util.ts so the live preview and
 * the saved quotation always agree. The server remains authoritative: only the
 * inputs (price, quantity, line discount, discounts) are ever submitted.
 */

import { roundMoney } from "./invoiceTotals.ts";

export { roundMoney };

export interface QuotationAmountLine {
  price: number;
  quantity: number;
  /** Absolute amount discounted on this line (currency, not percentage). */
  lineDiscount?: number;
}

export interface QuotationTotals {
  subtotal: number;
  lineDiscountTotal: number;
  netSubtotal: number;
  percentageDiscount: number;
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

/** Gross value of a line before any discount. */
export function quotationLineGross(line: QuotationAmountLine): number {
  return roundMoney(Math.max(0, line.price) * Math.max(0, line.quantity));
}

/** Line value after its own line discount. */
export function quotationLineNetAmount(line: QuotationAmountLine): number {
  const gross = quotationLineGross(line);
  const discount = Math.min(Math.max(0, Number(line.lineDiscount) || 0), gross);
  return roundMoney(gross - discount);
}

/**
 * Discount to send to the invoice when converting a quotation.
 *
 * InvoiceItem has no line-discount column, so the quotation's line discounts,
 * percentage discount and fixed discount all collapse into the invoice's fixed
 * discount. Invoice lines keep the quoted gross price, which preserves the
 * quoted total exactly.
 */
export function quotationConversionDiscount(quotation: {
  subtotal: number;
  lineDiscountTotal: number;
  discountPercentage: number;
  discountAmount: number;
}): number {
  const netSubtotal = Math.max(0, Number(quotation.subtotal) - Number(quotation.lineDiscountTotal));
  const percentageDiscount = roundMoney(
    netSubtotal * (Math.max(0, Math.min(Number(quotation.discountPercentage) || 0, 100)) / 100),
  );
  return roundMoney(
    Number(quotation.lineDiscountTotal) + percentageDiscount + Number(quotation.discountAmount),
  );
}

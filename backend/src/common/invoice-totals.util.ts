/**
 * Single source of truth for invoice money math on the server.
 *
 * Money is always rounded to 2 decimal places before it is persisted or
 * compared. Callers must never send client-calculated totals here — the
 * service recomputes them from the stored line items.
 */

export const MONEY_DECIMAL_PLACES = 2;

export const roundMoney = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** MONEY_DECIMAL_PLACES;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export interface InvoiceAmountLine {
  price: number;
  quantity: number;
}

export interface InvoiceTotals {
  subtotal: number;
  percentageDiscount: number;
  fixedDiscount: number;
  total: number;
}

/**
 * Discounts are applied in a fixed order:
 *   1. percentage on the subtotal
 *   2. fixed amount, capped by what remains after the percentage
 *   3. total floored at 0
 *
 * This matches the create-invoice form and prevents a fixed discount from
 * pushing the invoice below zero when combined with a percentage.
 */
export function calculateInvoiceTotals(
  items: InvoiceAmountLine[],
  discountPercentage = 0,
  discountAmount = 0,
): InvoiceTotals {
  const subtotal = roundMoney(
    (items ?? []).reduce((sum, item) => sum + roundMoney(item.price * item.quantity), 0),
  );
  const safePercentage = Math.max(0, Math.min(discountPercentage || 0, 100));
  const safeFixed = Math.max(0, discountAmount || 0);
  const percentageDiscount = roundMoney(subtotal * (safePercentage / 100));
  const fixedDiscount = roundMoney(Math.min(safeFixed, Math.max(0, subtotal - percentageDiscount)));
  const total = roundMoney(Math.max(0, subtotal - percentageDiscount - fixedDiscount));

  return { subtotal, percentageDiscount, fixedDiscount, total };
}

/**
 * Ratio of what the customer actually pays per currency unit of list price.
 *
 * The invoice-level discount terms (`originalTotal` + discount columns) are
 * snapshots taken at creation, so this factor is stable for the whole life of
 * the invoice. Using it for every price edit and every refund removes the
 * drift caused by recomputing `currentTotal / adjustedSubtotal` after each
 * return.
 */
export function calculateInvoiceDiscountFactor(
  originalTotal: number,
  discountPercentage = 0,
  discountAmount = 0,
): number {
  const original = roundMoney(originalTotal);
  if (original <= 0) {
    // A zero-value invoice has no discount ratio to apply. New lines added to
    // it are valued at their full price.
    return 1;
  }

  const { total } = calculateInvoiceTotals([{ price: original, quantity: 1 }], discountPercentage, discountAmount);
  const factor = total / original;
  return Math.max(0, Math.min(1, factor));
}

/**
 * Value of the lines that are still owned by the customer (i.e. not returned),
 * after the invoice-level discount factor is allocated proportionally.
 */
export function calculateOutstandingInvoiceTotal(
  lines: InvoiceAmountLine[],
  discountFactor: number,
): { subtotal: number; total: number } {
  const safeFactor = Math.max(0, Math.min(1, discountFactor));
  let subtotal = 0;
  let total = 0;

  for (const line of lines ?? []) {
    const lineAmount = roundMoney(line.price * line.quantity);
    subtotal = roundMoney(subtotal + lineAmount);
    total = roundMoney(total + roundMoney(lineAmount * safeFactor));
  }

  return { subtotal, total: roundMoney(Math.max(0, total)) };
}

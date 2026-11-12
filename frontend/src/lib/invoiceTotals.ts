/**
 * Single source of truth for invoice money math in the UI.
 *
 * These helpers mirror backend/src/common/invoice-totals.util.ts so a preview
 * shown to the user matches what the server will persist. The server remains
 * authoritative: never submit a computed total, only the inputs.
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

export function calculateInvoiceDiscountFactor(
  originalTotal: number,
  discountPercentage = 0,
  discountAmount = 0,
): number {
  const original = roundMoney(originalTotal);
  if (original <= 0) return 1;

  const { total } = calculateInvoiceTotals([{ price: original, quantity: 1 }], discountPercentage, discountAmount);
  const factor = total / original;
  return Math.max(0, Math.min(1, factor));
}

/**
 * Totals for a saved invoice document.
 *
 * `originalTotal` is a creation-time snapshot the backend uses to derive the
 * invoice's discount factor. Price adjustments change the effective unit price
 * of existing lines, so printing the snapshot would leave a stale total next to
 * the adjusted line prices. Rebuild the subtotal from the effective line prices
 * and keep the discount terms (factor) from the original snapshot.
 */
export function calculateInvoiceDocumentTotals(
  items: InvoiceAmountLine[],
  originalTotal: number,
  discountPercentage = 0,
  discountAmount = 0,
): InvoiceTotals {
  const subtotal = roundMoney(
    (items ?? []).reduce((sum, item) => sum + roundMoney(item.price * item.quantity), 0),
  );
  const safePercentage = Math.max(0, Math.min(discountPercentage || 0, 100));
  const discountFactor = calculateInvoiceDiscountFactor(
    originalTotal,
    safePercentage,
    discountAmount,
  );
  const percentageDiscount = roundMoney(subtotal * (safePercentage / 100));
  const total = roundMoney(subtotal * discountFactor);
  // Fixed discount scaled by the same factor so the printed rows add up.
  const fixedDiscount = roundMoney(
    Math.max(
      0,
      Math.min(subtotal - percentageDiscount, subtotal - percentageDiscount - total),
    ),
  );

  return { subtotal, percentageDiscount, fixedDiscount, total };
}

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

/** Latest approved price wins; `InvoiceItem.price` is the original sale price. */
export function getEffectivePrice(item: {
  price: number;
  priceAdjustments?: { newPrice: number }[] | null;
}): number {
  const latest = item.priceAdjustments?.[0];
  return roundMoney(latest ? Number(latest.newPrice) : Number(item.price));
}

/**
 * Quantity that is still owned by the customer. Returns are stored as separate
 * rows, so they must be subtracted from the sold quantity.
 */
export function getRemainingQuantity(
  invoiceItemId: number,
  soldQuantity: number,
  returns?: { items?: { invoiceItemId: number; quantity?: number }[] }[] | null,
): number {
  const returned = (returns ?? [])
    .flatMap((invoiceReturn) => invoiceReturn.items ?? [])
    .filter((item) => item.invoiceItemId === invoiceItemId)
    .reduce((sum, item) => sum + Number(item.quantity ?? 1), 0);

  return Math.max(0, roundMoney(Number(soldQuantity) - returned));
}

import { roundMoney } from "../../lib/quotationTotals.ts";
import {
  formatPrintDate,
  formatPrintNumber,
} from "../printing/utils/formatters.ts";

export interface QuotationShareLine {
  productName: string;
  quantity: number;
  price: number;
}

export interface QuotationShareInput {
  quotationNumber: string;
  customerName: string;
  validUntil: string | Date;
  subtotal: number;
  total: number;
  items: QuotationShareLine[];
}

export interface QuotationShareTemplates {
  /** Whole message. Placeholders: {number} {customer} {lines} {totals} {validUntil}. */
  message: string;
  /** One item line. Placeholders: {index} {product} {price} {quantity} {lineTotal} {currency}. */
  line: string;
  /** Totals block without a discount. Placeholders: {total} {currency}. */
  totals: string;
  /** Totals block with a discount. Placeholders: {subtotal} {discount} {total} {currency}. */
  totalsWithDiscount: string;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function formatMoney(value: number): string {
  return formatPrintNumber(Math.round(value), {
    decimals: 0,
    useGrouping: false,
  });
}

/** Quantities can be fractional; drop trailing zeroes for whole numbers. */
function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Build the WhatsApp / share message for a quotation.
 *
 * Each item is rendered as "unit price × quantity = line total" (gross, before
 * any line discount) and the message ends with the quotation totals. Monetary
 * values are sent as whole numbers (no decimals). When the quotation has
 * discounts, a subtotal + discount row is inserted so the final total is
 * arithmetically consistent with the item lines.
 */
export function buildQuotationShareText(
  quotation: QuotationShareInput,
  templates: QuotationShareTemplates,
  currency: string,
): string {
  let displayedSubtotal = 0;

  const lines = (quotation.items ?? [])
    .map((item, index) => {
      const price = Math.max(0, Number(item.price) || 0);
      const quantity = Math.max(0, Number(item.quantity) || 0);
      const lineTotal = Math.round(roundMoney(price * quantity));
      displayedSubtotal += lineTotal;

      return fill(templates.line, {
        index: String(index + 1),
        product: item.productName,
        price: formatMoney(price),
        quantity: formatQuantity(quantity),
        lineTotal: formatMoney(lineTotal),
        currency,
      });
    })
    .join("\n");

  const total = Math.round(Math.max(0, Number(quotation.total) || 0));
  // Derive the displayed discount from the visible integers, so the message
  // always adds up: sum(line totals) - discount = total.
  const discount = Math.max(0, displayedSubtotal - total);

  const totals = fill(
    discount > 0 ? templates.totalsWithDiscount : templates.totals,
    {
      subtotal: formatMoney(displayedSubtotal),
      discount: formatMoney(discount),
      total: formatMoney(total),
      currency,
    },
  );

  return fill(templates.message, {
    number: quotation.quotationNumber,
    customer: quotation.customerName,
    lines,
    totals,
    validUntil: formatPrintDate(quotation.validUntil),
  });
}

import { calculateQuotationTotals } from "../../lib/quotationTotals";
import type { Quotation } from "../../types";
import type {
  QuotationDocumentData,
  QuotationDocumentLine,
} from "./components/QuotationDocument";

interface PreviewInput {
  quotationNumber?: string;
  date: string;
  validUntil: string;
  customerName: string;
  customerPhone?: string | null;
  employeeName: string;
  notes?: string | null;
  discountPercentage: number;
  discountAmount: number;
  items: QuotationDocumentLine[];
}

function withTotals(
  items: QuotationDocumentLine[],
  discountPercentage: number,
  discountAmount: number,
) {
  const totals = calculateQuotationTotals(
    items.map((item) => ({
      price: item.price,
      quantity: item.quantity,
      lineDiscount: item.lineDiscount ?? 0,
    })),
    discountPercentage,
    discountAmount,
  );

  return {
    subtotal: totals.subtotal,
    lineDiscountTotal: totals.lineDiscountTotal,
    percentageDiscount: totals.percentageDiscount,
    discountPercentage,
    fixedDiscount: totals.fixedDiscount,
    total: totals.total,
  };
}

/** Map a saved quotation to the printable document model. */
export function createQuotationDocumentData(
  quotation: Quotation,
  options?: { printedAt?: Date; statusLabel?: string },
): QuotationDocumentData {
  const items: QuotationDocumentLine[] = quotation.items.map((item) => ({
    id: item.id,
    name: item.productName,
    unit: item.unit,
    quantity: Number(item.quantity),
    price: Number(item.price),
    lineDiscount: Number(item.lineDiscount),
  }));

  return {
    quotationNumber: quotation.quotationNumber,
    date: quotation.date,
    validUntil: quotation.validUntil,
    customerName: quotation.customerName,
    customerPhone: quotation.customerPhone,
    employeeName: quotation.createdBy?.name ?? "",
    status: quotation.effectiveStatus,
    statusLabel: options?.statusLabel,
    notes: quotation.notes,
    items,
    printedAt: options?.printedAt,
    ...withTotals(
      items,
      Number(quotation.discountPercentage),
      Number(quotation.discountAmount),
    ),
  };
}

/** Build the same document model from unsaved form state (live preview). */
export function createQuotationPreviewData(
  input: PreviewInput,
  previewSubtitle?: string,
): QuotationDocumentData {
  return {
    quotationNumber: input.quotationNumber ?? "",
    date: input.date,
    validUntil: input.validUntil,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    employeeName: input.employeeName,
    notes: input.notes,
    items: input.items,
    previewSubtitle,
    ...withTotals(
      input.items,
      input.discountPercentage,
      input.discountAmount,
    ),
  };
}

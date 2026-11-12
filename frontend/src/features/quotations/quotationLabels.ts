import type { TranslationKey } from "../../i18n";
import type { QuotationEventType, QuotationStatus } from "../../types";
import type { QuotationDocumentLabels } from "./components/QuotationDocument";

const STATUS_KEYS: Record<QuotationStatus, keyof TranslationKey["statusLabels"]> = {
  DRAFT: "draft",
  SENT: "sent",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
  CONVERTED: "converted",
};

/** Localized label for a (possibly effective) quotation status. */
export function quotationStatusLabel(
  t: TranslationKey,
  status: QuotationStatus,
): string {
  return t.statusLabels[STATUS_KEYS[status]];
}

const EVENT_KEYS: Record<
  QuotationEventType,
  keyof TranslationKey["quotations"]["events"]
> = {
  CREATED: "created",
  UPDATED: "updated",
  SENT: "sent",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
  REVISED: "revised",
  CONVERTED: "converted",
  DELETED: "deleted",
};

/** Localized label for a quotation timeline entry. */
export function quotationEventLabel(
  t: TranslationKey,
  type: QuotationEventType,
): string {
  return t.quotations.events[EVENT_KEYS[type]];
}

/** Labels consumed by the printable quotation document. */
export function buildQuotationDocumentLabels(
  t: TranslationKey,
): QuotationDocumentLabels {
  return {
    title: t.quotations.documentTitle,
    quotation: t.quotations.quotationNumber,
    date: t.date,
    validUntil: t.quotations.validUntil,
    customer: t.quotations.customer,
    employee: t.quotations.employee,
    status: t.status,
    note: t.quotations.notes,
    product: t.quotations.product,
    quantity: t.quotations.quantity,
    price: t.quotations.price,
    lineDiscount: t.quotations.lineDiscount,
    lineTotal: t.quotations.lineTotal,
    subtotal: t.quotations.subtotal,
    lineDiscountTotal: t.quotations.lineDiscountTotal,
    discountPercent: t.quotations.discountPercentage,
    discountAmount: t.quotations.discountAmount,
    total: t.total,
    noItems: t.quotations.noItems,
    draft: t.quotations.draft,
    billTo: t.quotations.billTo,
    printedAt: t.quotations.printedAt,
    meter: t.uom.METER,
    sl: t.printing.sl,
  };
}

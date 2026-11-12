import type {
  Invoice,
  InvoiceAuditLog,
  InvoiceItem,
  InvoiceStatus,
} from "../../../types";
import type {
  InvoiceDocumentAuditEntry,
  InvoiceDocumentData,
  InvoiceDocumentLine,
} from "../components/InvoiceDocument";
import {
  calculateInvoiceDocumentTotals,
  getEffectivePrice,
} from "../../../lib/invoiceTotals";
function toDocumentLine(item: InvoiceItem): InvoiceDocumentLine {
  const assignedBarcodes = (item.unitAssignments ?? [])
    .filter(
      (assignment) =>
        assignment.reversedAt === undefined || assignment.reversedAt === null,
    )
    .map((assignment) => assignment.productUnit?.barcode)
    .filter((barcode): barcode is string => Boolean(barcode));

  return {
    id: item.id,
    name:
      item.productUnit?.productModel?.name ||
      item.productModel?.name ||
      "",
    quantity: Number(item.quantity ?? 1),
    unit: item.productModel?.unit,
    barcode: assignedBarcodes.length
      ? assignedBarcodes.join(", ")
      : item.productUnit?.barcode,
    price: getEffectivePrice(item),
  };
}

export function createInvoiceDocumentData(
  invoice: Invoice,
  auditLogs: InvoiceAuditLog[],
  printedAt: Date | undefined,
  translateAction: (action: string) => string,
  translateStatus: (status: InvoiceStatus) => string = (status) => status,
): InvoiceDocumentData {
  const auditEntries: InvoiceDocumentAuditEntry[] = auditLogs.map((entry) => ({
    id: entry.id,
    action: translateAction(entry.action),
    employeeName: entry.employee?.name ?? "",
    timestamp: entry.timestamp,
  }));

  // The visible lines use effective (post-adjustment) prices, so the document
  // subtotal must be rebuilt from them instead of the creation-time snapshot.
  const documentTotals = calculateInvoiceDocumentTotals(
    invoice.items.map((item) => ({
      price: getEffectivePrice(item),
      quantity: Number(item.quantity ?? 1),
    })),
    Number(invoice.originalTotal ?? 0),
    Number(invoice.discountPercentage ?? 0),
    Number(invoice.discountAmount ?? 0),
  );

  return {
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    customerName: invoice.customer?.name ?? "",
    customerPhone: invoice.customer?.phone,
    employeeName: invoice.employee?.name ?? "",
    status: invoice.status,
    statusLabel: translateStatus(invoice.status),
    paymentType: invoice.paymentType,
    note: invoice.note,
    originalTotal: documentTotals.subtotal,
    currentTotal: invoice.currentTotal,
    discountPercentage: invoice.discountPercentage,
    discountAmount: documentTotals.fixedDiscount,
    percentageDiscount: documentTotals.percentageDiscount,
    items: invoice.items.map(toDocumentLine),
    auditEntries,
    printedAt,
  };
}

export function createInvoicePreviewData(input: {
  invoiceNumber: string;
  date: Date;
  customerName: string;
  customerPhone?: string | null;
  employeeName: string;
  paymentType: string;
  note?: string;
  subtotal: number;
  percentageDiscount: number;
  discountPercentage: number;
  fixedDiscount: number;
  total: number;
  previewSubtitle: string;
  items: InvoiceDocumentLine[];
}): InvoiceDocumentData {
  return {
    invoiceNumber: input.invoiceNumber,
    date: input.date,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    employeeName: input.employeeName,
    paymentType: input.paymentType,
    note: input.note?.trim() || null,
    originalTotal: input.subtotal,
    currentTotal: input.total,
    percentageDiscount: input.percentageDiscount,
    discountPercentage: input.discountPercentage,
    discountAmount: input.fixedDiscount,
    previewSubtitle: input.previewSubtitle,
    items: input.items,
  };
}

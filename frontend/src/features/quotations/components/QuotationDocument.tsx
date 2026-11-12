import { memo } from "react";
import PrintDocumentLayout from "../../printing/components/PrintDocumentLayout";
import {
  formatPrintCurrency,
  formatPrintDate,
  formatPrintDateTime,
} from "../../printing/utils/formatters";

export interface QuotationDocumentLine {
  id: number | string;
  name: string;
  quantity: number;
  unit?: string;
  price: number;
  lineDiscount?: number;
}

export interface QuotationDocumentData {
  quotationNumber: string;
  date: string | Date;
  validUntil: string | Date;
  customerName: string;
  customerPhone?: string | null;
  employeeName: string;
  status?: string;
  statusLabel?: string;
  notes?: string | null;
  subtotal: number;
  lineDiscountTotal?: number;
  percentageDiscount?: number;
  discountPercentage?: number;
  fixedDiscount?: number;
  total: number;
  items: QuotationDocumentLine[];
  printedAt?: Date;
  previewSubtitle?: string;
}

export interface QuotationDocumentLabels {
  title: string;
  quotation: string;
  date: string;
  validUntil: string;
  customer: string;
  employee: string;
  status: string;
  note: string;
  product: string;
  quantity: string;
  price: string;
  lineDiscount: string;
  lineTotal: string;
  subtotal: string;
  lineDiscountTotal: string;
  discountPercent: string;
  discountAmount: string;
  total: string;
  noItems: string;
  draft: string;
  billTo: string;
  printedAt: string;
  meter: string;
  sl: string;
}

interface QuotationDocumentProps {
  data: QuotationDocumentData;
  labels: QuotationDocumentLabels;
  currency: string;
  mode: "saved" | "preview";
}

/**
 * Quotation print sheet. Uses the same A4 layout / safe margins as invoices
 * (features/printing/print.css) so every printable document is consistent.
 */
const QUOTATION_PRINT_CSS = `
@media print {
  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
  }

  .quotation-document {
    box-sizing: border-box;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .quotation-document *,
  .quotation-document *::before,
  .quotation-document *::after {
    box-sizing: border-box;
  }

  .quotation-document .pn-items {
    width: 100%;
    max-width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }

  .quotation-document .pn-items th,
  .quotation-document .pn-items td {
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .quotation-document .pn-items thead {
    display: table-header-group;
  }

  .quotation-document .pn-items tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .quotation-document .pn-bottom,
  .quotation-document .pn-totals,
  .quotation-document .pn-note {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;

function QuotationDocument({
  data,
  labels,
  currency,
  mode,
}: QuotationDocumentProps) {
  const isPreview = mode === "preview";
  const money = (value: number | string | undefined) =>
    formatPrintCurrency(value ?? 0, currency, { useGrouping: false });
  const hasLineDiscount = (data.lineDiscountTotal ?? 0) > 0;
  const hasPercentageDiscount = (data.percentageDiscount ?? 0) > 0;
  const hasFixedDiscount = (data.fixedDiscount ?? 0) > 0;

  return (
    <PrintDocumentLayout
      title={labels.title}
      documentTitle="QUOTATION"
      documentNumber={data.quotationNumber || undefined}
      subtitle={isPreview ? data.previewSubtitle : undefined}
      className={`quotation-document quotation-document--${mode}`}
      headerVisibility={isPreview ? "always" : "print"}
    >
      <style>{QUOTATION_PRINT_CSS}</style>

      <section className="pn-parties">
        <div className="pn-parties__bill-to">
          <span className="pn-parties__label">{labels.billTo}</span>
          <strong className="pn-parties__name">
            <bdi dir="auto">{data.customerName || "—"}</bdi>
          </strong>
          {data.customerPhone && (
            <span className="pn-parties__line" dir="ltr">
              {data.customerPhone}
            </span>
          )}
          {!isPreview && data.status && (
            <span className="pn-status">{data.statusLabel ?? data.status}</span>
          )}
        </div>
        <dl className="pn-parties__meta">
          <dt>{labels.quotation}</dt>
          <dd dir="ltr">{data.quotationNumber || labels.draft}</dd>
          <dt>{labels.date}</dt>
          <dd dir="ltr">{formatPrintDate(data.date)}</dd>
          <dt>{labels.validUntil}</dt>
          <dd dir="ltr">{formatPrintDate(data.validUntil)}</dd>
          <dt>{labels.employee}</dt>
          <dd dir="auto">{data.employeeName || "—"}</dd>
          {data.printedAt && (
            <>
              <dt>{labels.printedAt}</dt>
              <dd dir="ltr">{formatPrintDateTime(data.printedAt)}</dd>
            </>
          )}
        </dl>
      </section>

      <table className="pn-items">
        <thead>
          <tr>
            <th scope="col" className="cell-center">
              {labels.sl}
            </th>
            <th scope="col">{labels.product}</th>
            <th scope="col" className="cell-end">
              {labels.price}
            </th>
            <th scope="col" className="cell-center">
              {labels.quantity}
            </th>
            <th scope="col" className="cell-end">
              {labels.lineDiscount}
            </th>
            <th scope="col" className="cell-end">
              {labels.lineTotal}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 ? (
            <tr>
              <td className="cell-empty" colSpan={6}>
                {labels.noItems}
              </td>
            </tr>
          ) : (
            data.items.map((item, index) => {
              const gross = item.price * item.quantity;
              return (
                <tr key={item.id}>
                  <td className="cell-sl" dir="ltr">
                    {index + 1}
                  </td>
                  <td className="cell-product">
                    <strong>
                      <bdi dir="auto">{item.name || "—"}</bdi>
                    </strong>
                  </td>
                  <td className="cell-num">
                    <bdi dir="ltr">{money(item.price)}</bdi>
                  </td>
                  <td className="cell-center cell-num">
                    {item.quantity}
                    {item.unit === "METER" ? ` ${labels.meter}` : ""}
                  </td>
                  <td className="cell-num">
                    <bdi dir="ltr">{money(item.lineDiscount ?? 0)}</bdi>
                  </td>
                  <td className="cell-num">
                    <bdi dir="ltr">{money(gross - (item.lineDiscount ?? 0))}</bdi>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <div className="pn-bottom">
        <div className="pn-bottom__start">
          {data.notes?.trim() && (
            <section className="pn-note">
              <span>{labels.note}</span>
              <p dir="auto">{data.notes}</p>
            </section>
          )}
        </div>

        <div className="pn-totals">
          <div className="pn-totals__row">
            <span>{labels.subtotal}</span>
            <strong dir="ltr">{money(data.subtotal)}</strong>
          </div>
          {hasLineDiscount && (
            <div className="pn-totals__row">
              <span>{labels.lineDiscountTotal}</span>
              <strong dir="ltr">- {money(data.lineDiscountTotal)}</strong>
            </div>
          )}
          {hasPercentageDiscount && (
            <div className="pn-totals__row">
              <span>
                {labels.discountPercent} ({data.discountPercentage}%)
              </span>
              <strong dir="ltr">- {money(data.percentageDiscount)}</strong>
            </div>
          )}
          {hasFixedDiscount && (
            <div className="pn-totals__row">
              <span>{labels.discountAmount}</span>
              <strong dir="ltr">- {money(data.fixedDiscount)}</strong>
            </div>
          )}
          <div className="pn-total-bar">
            <span className="pn-total-bar__chip">{labels.total}</span>
            <strong className="pn-total-bar__amount" dir="ltr">
              {money(data.total)}
            </strong>
          </div>
        </div>
      </div>
    </PrintDocumentLayout>
  );
}

export default memo(QuotationDocument);

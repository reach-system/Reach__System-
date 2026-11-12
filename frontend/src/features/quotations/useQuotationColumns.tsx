import type { CSSProperties } from "react";
import type { Column } from "../../components/ui/Table";
import { useI18n } from "../../i18n/context";
import type { Quotation } from "../../types";
import {
  formatPrintDate,
  formatPrintNumber,
} from "../printing/utils/formatters";
import QuotationStatusBadge from "./components/QuotationStatusBadge";

export type QuotationColumnKey =
  | "quotationNumber"
  | "customer"
  | "employee"
  | "date"
  | "validUntil"
  | "status"
  | "itemCount"
  | "total";

const DEFAULT_COLUMN_ORDER: QuotationColumnKey[] = [
  "quotationNumber",
  "customer",
  "employee",
  "date",
  "validUntil",
  "status",
  "itemCount",
  "total",
];

const numberStyle: CSSProperties = {
  fontFamily: "'Manrope', sans-serif",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const dateCellStyle: CSSProperties = {
  whiteSpace: "nowrap",
  color: "var(--soft)",
  fontVariantNumeric: "tabular-nums",
};

const amountCellStyle: CSSProperties = {
  display: "block",
  textAlign: "end",
  direction: "ltr",
  whiteSpace: "nowrap",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

const formatDate = (value: string | Date | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : formatPrintDate(date);
};

/**
 * One source of truth for how a quotation row is rendered. The list page and
 * the report's detailed table reuse it so number/status/total never drift.
 */
export function useQuotationColumns(options?: {
  include?: QuotationColumnKey[];
}): Column<Quotation>[] {
  const { t } = useI18n();
  const order = options?.include ?? DEFAULT_COLUMN_ORDER;

  const columns: Record<QuotationColumnKey, Column<Quotation>> = {
    quotationNumber: {
      key: "quotationNumber",
      label: t.quotations.quotationNumber,
      sortable: true,
      render: (quotation) => (
        <span style={numberStyle}>{quotation.quotationNumber}</span>
      ),
    },
    customer: {
      key: "customerName",
      label: t.quotations.customer,
      sortable: true,
      render: (quotation) => (
        <span title={quotation.customerPhone ?? undefined}>
          {quotation.customerName}
        </span>
      ),
    },
    employee: {
      key: "employeeName",
      label: t.quotations.employee,
      render: (quotation) => quotation.createdBy?.name ?? "—",
    },
    date: {
      key: "date",
      label: t.date,
      sortable: true,
      render: (quotation) => (
        <span style={dateCellStyle}>{formatDate(quotation.date)}</span>
      ),
    },
    validUntil: {
      key: "validUntil",
      label: t.quotations.validUntil,
      sortable: true,
      render: (quotation) => (
        <span
          style={{
            ...dateCellStyle,
            color: quotation.isExpired ? "var(--accent)" : "var(--soft)",
          }}
        >
          {formatDate(quotation.validUntil)}
        </span>
      ),
    },
    status: {
      key: "status",
      label: t.status,
      sortable: true,
      render: (quotation) => (
        <QuotationStatusBadge status={quotation.effectiveStatus} />
      ),
    },
    itemCount: {
      key: "itemCount",
      label: t.quotations.items,
      align: "right",
      render: (quotation) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {quotation.itemCount ?? quotation.items?.length ?? 0}
        </span>
      ),
    },
    total: {
      key: "total",
      label: t.total,
      align: "right",
      sortable: true,
      render: (quotation) => (
        <span style={amountCellStyle}>
          {formatPrintNumber(quotation.total)} {t.currency}
        </span>
      ),
    },
  };

  return order.map((key) => columns[key]);
}

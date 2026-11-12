import { useI18n } from "../../../i18n/context";
import type { QuotationStatus } from "../../../types";
import { quotationStatusLabel } from "../quotationLabels";

interface QuotationStatusBadgeProps {
  status: QuotationStatus;
  /** Optional override (e.g. a localized label from a surrounding component). */
  label?: string;
}

const STATUS_STYLES: Record<QuotationStatus, { color: string; bg: string }> = {
  DRAFT: { color: "var(--soft)", bg: "var(--bg-active)" },
  SENT: { color: "var(--peach)", bg: "var(--peach-bg)" },
  ACCEPTED: { color: "var(--mint)", bg: "var(--mint-bg)" },
  REJECTED: { color: "var(--accent)", bg: "var(--accent-bg)" },
  EXPIRED: { color: "var(--soft)", bg: "var(--bg-active)" },
  CONVERTED: { color: "var(--brand)", bg: "var(--brand-bg)" },
};

/**
 * Quotation statuses (DRAFT/SENT/…) are deliberately separate from invoice
 * statuses: StatusChip owns the invoice/unit vocabulary and must not be bent
 * to fit another lifecycle.
 */
export function QuotationStatusBadge({
  status,
  label,
}: QuotationStatusBadgeProps) {
  const { t } = useI18n();
  const { color, bg } = STATUS_STYLES[status];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "2px 10px",
        borderRadius: "999px",
        backgroundColor: bg,
        color,
        fontFamily: "'Manrope', sans-serif",
        fontSize: "12px",
        fontWeight: 600,
        lineHeight: "22px",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {label ?? quotationStatusLabel(t, status)}
    </span>
  );
}

export default QuotationStatusBadge;

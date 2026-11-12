import { BadRequestException } from '@nestjs/common';
import { QuotationStatus } from '@prisma/client';

/**
 * Allowed lifecycle transitions for a single quotation row.
 *
 * Revise/replace is not a transition: it creates a new DRAFT linked to the
 * source quotation (SENT / REJECTED / EXPIRED), leaving the original intact.
 */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  [QuotationStatus.DRAFT]: [QuotationStatus.SENT],
  [QuotationStatus.SENT]: [
    QuotationStatus.ACCEPTED,
    QuotationStatus.REJECTED,
    QuotationStatus.EXPIRED,
    QuotationStatus.CONVERTED,
  ],
  [QuotationStatus.ACCEPTED]: [QuotationStatus.CONVERTED],
  [QuotationStatus.REJECTED]: [],
  [QuotationStatus.EXPIRED]: [],
  [QuotationStatus.CONVERTED]: [],
};

export function canTransition(from: QuotationStatus, to: QuotationStatus): boolean {
  return (QUOTATION_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: QuotationStatus, to: QuotationStatus): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException({
      code: 'INVALID_QUOTATION_STATUS',
      message: `Cannot move a quotation from ${from} to ${to}`,
    });
  }
}

/** Only DRAFT quotations may be edited. */
export function isEditable(status: QuotationStatus): boolean {
  return status === QuotationStatus.DRAFT;
}

/** Revision is allowed after the quote left DRAFT but before conversion. */
export function canRevise(status: QuotationStatus): boolean {
  return (
    status === QuotationStatus.SENT ||
    status === QuotationStatus.REJECTED ||
    status === QuotationStatus.EXPIRED
  );
}

/** Conversion needs an accepted (or still-open) sent quotation. */
export function canConvert(status: QuotationStatus): boolean {
  return status === QuotationStatus.SENT || status === QuotationStatus.ACCEPTED;
}

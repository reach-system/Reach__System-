/**
 * Quotation validity is expressed as a business day in Africa/Cairo.
 *
 * `Quotation.validUntil` stores the *inclusive end-of-day instant* for that
 * business day (23:59:59.999 Cairo time) as a UTC timestamp. That keeps every
 * comparison in the service a plain UTC comparison and removes the usual
 * "expired 00:00 vs 23:59" and DST bugs.
 */

import { QuotationStatus } from '@prisma/client';

export const QUOTATION_TIMEZONE = 'Africa/Cairo';

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateOnly(value: string): boolean {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function timeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);

  // Intl may report midnight as hour 24.
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') === 24 ? 0 : get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
export function getTimeZoneOffsetMs(date: Date, timeZone = QUOTATION_TIMEZONE): number {
  const parts = timeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const instantWithoutMs = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - instantWithoutMs;
}

export function formatDateInTimeZone(date: Date, timeZone = QUOTATION_TIMEZONE): string {
  const parts = timeZoneParts(date, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * Convert a `YYYY-MM-DD` business day to the UTC instant at which it ends in
 * Africa/Cairo (inclusive: 23:59:59.999 local).
 */
export function zonedEndOfDay(dateOnly: string, timeZone = QUOTATION_TIMEZONE): Date {
  if (!isValidDateOnly(dateOnly)) {
    throw new Error(`Invalid date "${dateOnly}". Expected YYYY-MM-DD`);
  }

  const [year, month, day] = dateOnly.split('-').map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, 23, 59, 59);

  // Two passes handle a DST change that happens during the day.
  let instant = new Date(localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone));
  instant = new Date(localAsUtc - getTimeZoneOffsetMs(instant, timeZone));

  // If the offset lookup landed on the wrong side of a transition, nudge by
  // the difference between the requested wall-clock time and the result.
  const resultParts = timeZoneParts(instant, timeZone);
  const resultWall = Date.UTC(
    resultParts.year,
    resultParts.month - 1,
    resultParts.day,
    resultParts.hour,
    resultParts.minute,
    resultParts.second,
  );
  const wantedWall = localAsUtc;
  const correction = wantedWall - resultWall;
  if (correction !== 0) {
    instant = new Date(instant.getTime() + correction);
  }

  return new Date(instant.getTime() + 999);
}

/** Start of the business day in Cairo, used by report date filters. */
export function zonedStartOfDay(dateOnly: string, timeZone = QUOTATION_TIMEZONE): Date {
  if (!isValidDateOnly(dateOnly)) {
    throw new Error(`Invalid date "${dateOnly}". Expected YYYY-MM-DD`);
  }

  const [year, month, day] = dateOnly.split('-').map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const first = new Date(localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone));
  return new Date(localAsUtc - getTimeZoneOffsetMs(first, timeZone));
}

export function isQuotationExpired(
  validUntil: Date | string,
  now: Date = new Date(),
): boolean {
  const end = validUntil instanceof Date ? validUntil : new Date(validUntil);
  return end.getTime() < now.getTime();
}

/**
 * Expiry is a computed read concern: a SENT quotation whose validity ended is
 * reported as EXPIRED even if the background job has not persisted it yet.
 */
export function effectiveQuotationStatus(
  status: QuotationStatus,
  validUntil: Date | string,
  now: Date = new Date(),
): QuotationStatus {
  if (status === QuotationStatus.SENT && isQuotationExpired(validUntil, now)) {
    return QuotationStatus.EXPIRED;
  }
  return status;
}

/** Default validity window for a new quotation (business days = calendar days here). */
export function defaultValidUntil(days = 14, from: Date = new Date()): Date {
  const end = new Date(from.getTime());
  end.setUTCDate(end.getUTCDate() + days);
  return zonedEndOfDay(formatDateInTimeZone(end));
}

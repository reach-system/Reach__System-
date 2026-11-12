import {
  defaultValidUntil,
  effectiveQuotationStatus,
  formatDateInTimeZone,
  isQuotationExpired,
  zonedEndOfDay,
  zonedStartOfDay,
} from './quotation-time.util';
import { QuotationStatus } from '@prisma/client';

describe('quotation business-day boundaries (Africa/Cairo)', () => {
  it('ends a summer day at 23:59:59.999 Cairo (UTC+3)', () => {
    const end = zonedEndOfDay('2026-07-15');
    expect(end.toISOString()).toBe('2026-07-15T20:59:59.999Z');
    expect(formatDateInTimeZone(end)).toBe('2026-07-15');
  });

  it('ends a winter day at 23:59:59.999 Cairo (UTC+2)', () => {
    const end = zonedEndOfDay('2026-01-15');
    expect(end.toISOString()).toBe('2026-01-15T21:59:59.999Z');
    expect(formatDateInTimeZone(end)).toBe('2026-01-15');
  });

  it('starts a summer day at 00:00 Cairo', () => {
    expect(zonedStartOfDay('2026-07-15').toISOString()).toBe('2026-07-14T21:00:00.000Z');
  });

  it('is still valid at 23:59:59.999 and expired at the next millisecond', () => {
    const end = zonedEndOfDay('2026-07-15');
    expect(isQuotationExpired(end, new Date(end.getTime()))).toBe(false);
    expect(isQuotationExpired(end, new Date(end.getTime() + 1))).toBe(true);
  });

  it('reports a sent quotation as EXPIRED on read once validity ended', () => {
    const end = zonedEndOfDay('2026-07-15');
    expect(
      effectiveQuotationStatus(QuotationStatus.SENT, end, new Date(end.getTime() + 1)),
    ).toBe(QuotationStatus.EXPIRED);
    expect(
      effectiveQuotationStatus(QuotationStatus.ACCEPTED, end, new Date(end.getTime() + 1)),
    ).toBe(QuotationStatus.ACCEPTED);
  });

  it('rejects impossible calendar dates', () => {
    expect(() => zonedEndOfDay('2026-02-30')).toThrow();
    expect(() => zonedEndOfDay('15/07/2026')).toThrow();
  });

  it('defaults to a future end-of-day', () => {
    const now = new Date('2026-07-01T10:00:00.000Z');
    expect(defaultValidUntil(14, now).getTime()).toBeGreaterThan(now.getTime());
  });
});

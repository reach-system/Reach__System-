import { QuotationStatus } from '@prisma/client';
import {
  assertTransition,
  canConvert,
  canRevise,
  canTransition,
  isEditable,
} from './quotation-state.util';

describe('quotation state machine', () => {
  it('allows the documented happy path', () => {
    expect(canTransition(QuotationStatus.DRAFT, QuotationStatus.SENT)).toBe(true);
    expect(canTransition(QuotationStatus.SENT, QuotationStatus.ACCEPTED)).toBe(true);
    expect(canTransition(QuotationStatus.ACCEPTED, QuotationStatus.CONVERTED)).toBe(true);
    expect(canTransition(QuotationStatus.SENT, QuotationStatus.CONVERTED)).toBe(true);
  });

  it('rejects skipped or backwards transitions', () => {
    expect(canTransition(QuotationStatus.DRAFT, QuotationStatus.ACCEPTED)).toBe(false);
    expect(canTransition(QuotationStatus.REJECTED, QuotationStatus.ACCEPTED)).toBe(false);
    expect(canTransition(QuotationStatus.CONVERTED, QuotationStatus.SENT)).toBe(false);
    expect(() =>
      assertTransition(QuotationStatus.DRAFT, QuotationStatus.CONVERTED),
    ).toThrow();
  });

  it('only drafts are editable', () => {
    expect(isEditable(QuotationStatus.DRAFT)).toBe(true);
    expect(isEditable(QuotationStatus.SENT)).toBe(false);
  });

  it('revises expired, rejected and sent quotations only', () => {
    expect(canRevise(QuotationStatus.SENT)).toBe(true);
    expect(canRevise(QuotationStatus.REJECTED)).toBe(true);
    expect(canRevise(QuotationStatus.EXPIRED)).toBe(true);
    expect(canRevise(QuotationStatus.DRAFT)).toBe(false);
    expect(canRevise(QuotationStatus.CONVERTED)).toBe(false);
  });

  it('converts sent and accepted quotations only', () => {
    expect(canConvert(QuotationStatus.SENT)).toBe(true);
    expect(canConvert(QuotationStatus.ACCEPTED)).toBe(true);
    expect(canConvert(QuotationStatus.EXPIRED)).toBe(false);
  });
});

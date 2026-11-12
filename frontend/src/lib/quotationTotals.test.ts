import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateQuotationTotals,
  quotationConversionDiscount,
  quotationLineGross,
  quotationLineNetAmount,
} from "./quotationTotals.ts";

test("quotation totals round each line to 2 decimals", () => {
  const totals = calculateQuotationTotals([
    { price: 19.99, quantity: 3 },
    { price: 0.1, quantity: 3 },
  ]);

  assert.equal(totals.subtotal, 60.27);
  assert.equal(totals.lineDiscountTotal, 0);
  assert.equal(totals.total, 60.27);
});

test("per-line discounts apply before the quotation percentage", () => {
  const totals = calculateQuotationTotals(
    [
      { price: 100, quantity: 2, lineDiscount: 25 },
      { price: 50, quantity: 1 },
    ],
    10,
    5,
  );

  // gross 250, line discounts 25 -> net 225, 10% = 22.5, fixed 5
  assert.equal(totals.subtotal, 250);
  assert.equal(totals.lineDiscountTotal, 25);
  assert.equal(totals.netSubtotal, 225);
  assert.equal(totals.percentageDiscount, 22.5);
  assert.equal(totals.fixedDiscount, 5);
  assert.equal(totals.total, 197.5);
});

test("line discount is capped at the gross line amount", () => {
  const totals = calculateQuotationTotals([{ price: 100, quantity: 1, lineDiscount: 500 }]);
  assert.equal(totals.lineDiscountTotal, 100);
  assert.equal(totals.total, 0);
});

test("fixed discount cannot make the total negative", () => {
  const totals = calculateQuotationTotals([{ price: 100, quantity: 1 }], 60, 100);
  assert.equal(totals.percentageDiscount, 60);
  assert.equal(totals.fixedDiscount, 40);
  assert.equal(totals.total, 0);
});

test("percentage is clamped to 0..100", () => {
  assert.equal(calculateQuotationTotals([{ price: 100, quantity: 1 }], 140, 0).total, 0);
  assert.equal(calculateQuotationTotals([{ price: 100, quantity: 1 }], -10, 0).total, 100);
});

test("empty quotations stay at zero", () => {
  assert.deepEqual(calculateQuotationTotals([], 20, 10), {
    subtotal: 0,
    lineDiscountTotal: 0,
    netSubtotal: 0,
    percentageDiscount: 0,
    fixedDiscount: 0,
    total: 0,
  });
});

test("line helpers expose gross and net amounts", () => {
  assert.equal(quotationLineGross({ price: 19.99, quantity: 3 }), 59.97);
  assert.equal(quotationLineNetAmount({ price: 19.99, quantity: 3, lineDiscount: 5 }), 54.97);
  assert.equal(quotationLineNetAmount({ price: 10, quantity: 1, lineDiscount: 999 }), 0);
});

test("conversion collapses all quotation discounts into one invoice discount", () => {
  assert.equal(
    quotationConversionDiscount({
      subtotal: 250,
      lineDiscountTotal: 25,
      discountPercentage: 10,
      discountAmount: 5,
    }),
    52.5,
  );
});

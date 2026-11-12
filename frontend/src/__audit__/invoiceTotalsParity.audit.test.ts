import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateInvoiceTotals as calculateFrontendTotals } from "../lib/invoiceTotals.ts";
import { calculateInvoiceTotals as calculateBackendTotals } from "../../../backend/src/common/invoice-totals.util.ts";

test("backend and frontend invoice totals match for 1000 deterministic randomized inputs", () => {
  let state = 0x5eed1234;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };

  for (let caseNumber = 0; caseNumber < 1000; caseNumber += 1) {
    const lineCount = Math.floor(random() * 8);
    const items = Array.from({ length: lineCount }, () => ({
      price: Math.round(random() * 100_000) / 100,
      quantity: Math.round(random() * 10_000) / 100,
    }));
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const percentageDiscount = Math.round(random() * 10_000) / 100;
    const discountAmount = Math.round(random() * subtotal * 150) / 100;

    assert.deepEqual(
      calculateFrontendTotals(items, percentageDiscount, discountAmount),
      calculateBackendTotals(items, percentageDiscount, discountAmount),
      `totals differ for randomized case ${caseNumber}`,
    );
  }
});

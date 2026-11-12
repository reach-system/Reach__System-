import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateInvoiceDiscountFactor,
  calculateInvoiceDocumentTotals,
  calculateInvoiceTotals,
  calculateOutstandingInvoiceTotal,
  getEffectivePrice,
  getRemainingQuantity,
  roundMoney,
} from "./invoiceTotals.ts";

test("roundMoney removes float drift", () => {
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(450 * 3 * 0.9), 1215);
  assert.equal(roundMoney(Number.NaN), 0);
});

test("percentage discount is applied before the capped fixed discount", () => {
  assert.deepEqual(calculateInvoiceTotals([{ price: 100, quantity: 2 }], 10, 50), {
    subtotal: 200,
    percentageDiscount: 20,
    fixedDiscount: 50,
    total: 130,
  });
  assert.equal(calculateInvoiceTotals([{ price: 100, quantity: 1 }], 50, 80).total, 0);
});

test("discount factor comes from the original invoice terms", () => {
  assert.equal(calculateInvoiceDiscountFactor(200, 10, 0), 0.9);
  assert.equal(calculateInvoiceDiscountFactor(100, 0, 25), 0.75);
  assert.equal(calculateInvoiceDiscountFactor(0, 10, 0), 1);
});

test("outstanding totals only include remaining quantity", () => {
  const result = calculateOutstandingInvoiceTotal(
    [
      { price: 450, quantity: 2 },
      { price: 100, quantity: 1 },
    ],
    0.9,
  );

  assert.equal(result.subtotal, 1000);
  assert.equal(result.total, 900);
});

test("latest price adjustment wins over the original item price", () => {
  assert.equal(getEffectivePrice({ price: 450 }), 450);
  assert.equal(
    getEffectivePrice({
      price: 450,
      priceAdjustments: [{ newPrice: 440 }, { newPrice: 430 }],
    }),
    440,
  );
});

test("returned quantities reduce what is still outstanding", () => {
  const returns = [
    { items: [{ invoiceItemId: 1, quantity: 1 }] },
    { items: [{ invoiceItemId: 1, quantity: 0.5 }] },
  ];

  assert.equal(getRemainingQuantity(1, 3, returns), 1.5);
  assert.equal(getRemainingQuantity(2, 3, returns), 3);
  assert.equal(getRemainingQuantity(1, 1, returns), 0);
});

test("document totals rebuild the subtotal from adjusted line prices", () => {
  const totals = calculateInvoiceDocumentTotals(
    [{ price: 120, quantity: 2 }],
    200,
    10,
    0,
  );

  assert.deepEqual(totals, {
    subtotal: 240,
    percentageDiscount: 24,
    fixedDiscount: 0,
    total: 216,
  });
});

test("document totals keep the original discount proportion after a price change", () => {
  const totals = calculateInvoiceDocumentTotals(
    [{ price: 110, quantity: 2 }],
    200,
    0,
    50,
  );

  assert.deepEqual(totals, {
    subtotal: 220,
    percentageDiscount: 0,
    fixedDiscount: 55,
    total: 165,
  });
});

test("document totals match the plain calculation when prices are unchanged", () => {
  const totals = calculateInvoiceDocumentTotals(
    [{ price: 100, quantity: 2 }],
    200,
    10,
    50,
  );

  assert.deepEqual(totals, {
    subtotal: 200,
    percentageDiscount: 20,
    fixedDiscount: 50,
    total: 130,
  });
});

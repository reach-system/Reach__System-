import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuotationShareText } from "./quotationShareText.ts";

const templates = {
  message:
    "Quotation {number}\nCustomer: {customer}\n\n{lines}\n\n{totals}\nValid until: {validUntil}",
  line: "{index}) {product}\n{price} × {quantity} = {lineTotal} {currency}",
  totals: "Total: {total} {currency}",
  totalsWithDiscount:
    "Subtotal: {subtotal} {currency}\nDiscount: -{discount} {currency}\nTotal: {total} {currency}",
};

const quotation = {
  quotationNumber: "Q-0001",
  customerName: "Ahmed",
  validUntil: "2026-12-31T12:00:00.000Z",
  subtotal: 250,
  total: 250,
  items: [
    { productName: "Widget", quantity: 2, price: 100 },
    { productName: "Bolt", quantity: 1, price: 50 },
  ],
};

test("renders every item as unit price × quantity = line total, then the grand total", () => {
  const text = buildQuotationShareText(quotation, templates, "EGP");

  assert.equal(
    text,
    [
      "Quotation Q-0001",
      "Customer: Ahmed",
      "",
      "1) Widget",
      "100 × 2 = 200 EGP",
      "2) Bolt",
      "50 × 1 = 50 EGP",
      "",
      "Total: 250 EGP",
      "Valid until: 31/12/2026",
    ].join("\n"),
  );
});

test("formats fractional quantities without trailing zeroes", () => {
  const text = buildQuotationShareText(
    {
      ...quotation,
      subtotal: 37.5,
      total: 37.5,
      items: [{ productName: "Cable", quantity: 2.5, price: 15 }],
    },
    templates,
    "EGP",
  );

  assert.match(text, /1\) Cable\n15 × 2\.5 = 38 EGP/);
});

test("adds a subtotal and discount block only when the total is discounted", () => {
  const discounted = buildQuotationShareText(
    { ...quotation, subtotal: 250, total: 225 },
    templates,
    "EGP",
  );

  assert.match(
    discounted,
    /Subtotal: 250 EGP\nDiscount: -25 EGP\nTotal: 225 EGP/,
  );

  const plain = buildQuotationShareText(quotation, templates, "EGP");
  assert.doesNotMatch(plain, /Discount:/);
});

test("rounds monetary values to whole numbers", () => {
  const text = buildQuotationShareText(
    {
      ...quotation,
      subtotal: 39.98,
      total: 39.98,
      items: [{ productName: "Widget", quantity: 2, price: 19.99 }],
    },
    templates,
    "EGP",
  );

  assert.match(text, /20 × 2 = 40 EGP/);
  assert.match(text, /Total: 40 EGP/);
});

test("renders product names containing replacement tokens literally", () => {
  const text = buildQuotationShareText(
    {
      ...quotation,
      items: [{ productName: "Steel $& {price}", quantity: 1, price: 10 }],
    },
    templates,
    "EGP",
  );

  assert.match(text, /1\) Steel \$& \{price\}\n10 × 1 = 10 EGP/);
});

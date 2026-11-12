import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWhatsAppUrl, normalizeEgyptianPhone } from "./quotationPhone.ts";

test("normalizes local Egyptian mobile numbers", () => {
  assert.equal(normalizeEgyptianPhone("01012345678"), "201012345678");
  assert.equal(normalizeEgyptianPhone("011 2345 6789"), "201123456789");
  assert.equal(normalizeEgyptianPhone("012-3456-7890"), "201234567890");
  assert.equal(normalizeEgyptianPhone("01512345678"), "201512345678");
});

test("normalizes numbers that already carry the country code", () => {
  assert.equal(normalizeEgyptianPhone("+20 101 234 5678"), "201012345678");
  assert.equal(normalizeEgyptianPhone("201012345678"), "201012345678");
  assert.equal(normalizeEgyptianPhone("00201012345678"), "201012345678");
});

test("rejects values that are not Egyptian mobile numbers", () => {
  assert.equal(normalizeEgyptianPhone(""), null);
  assert.equal(normalizeEgyptianPhone(null), null);
  assert.equal(normalizeEgyptianPhone(undefined), null);
  assert.equal(normalizeEgyptianPhone("12345"), null);
  assert.equal(normalizeEgyptianPhone("+1 555 123 4567"), null);
  assert.equal(normalizeEgyptianPhone("hello"), null);
});

test("builds an encoded wa.me link", () => {
  const url = buildWhatsAppUrl("01012345678", "عرض سعر Q-0001\nالإجمالي: 100 EGP");
  assert.ok(url?.startsWith("https://wa.me/201012345678?text="));
  assert.ok(url?.includes(encodeURIComponent("عرض سعر Q-0001")));
  assert.equal(buildWhatsAppUrl(null, "hi"), null);
});

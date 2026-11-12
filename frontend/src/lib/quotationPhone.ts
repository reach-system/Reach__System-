/**
 * Normalise an Egyptian phone number for wa.me links.
 *
 * WhatsApp expects an international number without "+", spaces or dashes:
 *   01012345678   -> 201012345678
 *   +20 101 234 5678 -> 201012345678
 *   00201012345678 -> 201012345678
 *
 * Returns null when the input cannot represent an Egyptian number.
 */
export function normalizeEgyptianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = String(raw).replace(/[^\d+]/g, "");

  // Drop an international dialling prefix.
  if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/^\+/, "");

  if (!/^\d+$/.test(digits)) return null;

  if (digits.startsWith("20")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Egyptian mobile numbers are 10 digits after the country code and start
  // with 1 (010/011/012/015 -> 10/11/12/15).
  if (!/^1\d{9}$/.test(digits)) return null;

  return `20${digits}`;
}

/** Build a wa.me URL, or null when the number is not shareable. */
export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message: string,
): string | null {
  const normalized = normalizeEgyptianPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

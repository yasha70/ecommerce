'use strict';

/**
 * Normalise a user-supplied mobile number to E.164 digits (no "+").
 * Returns null when the number is not plausibly valid.
 *   "98765 43210"      -> "919876543210" (with default country code 91)
 *   "+1 (415) 555-0100" -> "14155550100"
 */
function normalizeMobile(input, defaultCountryCode) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let raw = String(input).trim();
  const hasPlus = raw.startsWith('+') || raw.startsWith('00');
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);

  if (!hasPlus) {
    digits = digits.replace(/^0+/, ''); // drop trunk prefix, e.g. 09876543210
    // A bare national number: prepend the default country code.
    if (digits.length <= 10 && defaultCountryCode) digits = defaultCountryCode + digits;
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  // Indian mobiles: 91 + 10 digits starting with 6-9.
  if (digits.startsWith('91') && digits.length === 12 && !/^91[6-9]/.test(digits)) return null;
  return digits;
}

/** 919876543210 -> +91******3210 (safe for logs and API responses). */
function maskMobile(digits) {
  if (!digits) return '';
  return '+' + digits.slice(0, digits.length - 10 > 0 ? digits.length - 10 : 2) +
    '*'.repeat(6) + digits.slice(-4);
}

module.exports = { normalizeMobile, maskMobile };

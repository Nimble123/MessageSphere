/**
 * MessageSphere Telecom & SMS Standards Module
 * Compliant with 3GPP TS 23.038 / GSM 03.38 & SMPP 3.4 / 5.0 specifications.
 */

// GSM-7 Basic Character Set (128 characters / 7-bit septets)
// Includes standard European and Latin accents: ä, ö, ñ, ü, à, §, Ä, Ö, Ñ, Ü, etc.
const GSM_7_REGEX =
  /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡¿ÄÖÑÜ§äöñüà\^{}\[~\]|€]*$/;

// GSM-7 Extended Characters (each requires an ESC 0x1B prefix, consuming 2 septets)
const GSM_7_EXTENDED_CHARS = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

/**
 * Standard SMPP 3.4 / 5.0 Delivery Status Tokens
 */
const SMPP_DELIVERED_STATUSES = new Set([
  'delivrd',
  'delivered',
  'sent',
  'success',
  'successful',
  'accepted',
  'd',
  'true',
  '1'
]);

const SMPP_FAILED_STATUSES = new Set([
  'undeliv',
  'undelivered',
  'failed',
  'fail',
  'rejectd',
  'rejected',
  'expired',
  'deleted',
  'unknown',
  'dnd',
  'blocked',
  'dropped',
  'error',
  'f',
  'false',
  '0'
]);

/**
 * Normalise a phone number from report files or raw input.
 * Strips whitespace/punctuation and normalises standard Indian / International prefixes.
 * @param {string} raw
 * @returns {string}
 */
function normalizePhoneNumber(raw) {
  if (!raw) return '';
  let cleaned = String(raw).replace(/[^0-9]/g, '').trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    cleaned = '91' + cleaned;
  }
  return cleaned;
}

/**
 * Calculate SMS encoding, effective character length, and concatenation segments.
 * 
 * Standard 3GPP Concatenation Rules:
 * - GSM-7 Single Message: up to 160 characters (1 part)
 * - GSM-7 Multi-part Message: 153 characters per part (7 chars consumed by UDH)
 * - Unicode (UCS-2) Single Message: up to 70 characters (1 part)
 * - Unicode (UCS-2) Multi-part Message: 67 characters per part (3 chars consumed by UDH)
 * 
 * @param {string} text Raw message content
 * @returns {{ character_count: number, is_unicode: boolean, parts_count: number, carrier_warning: string|null }}
 */
function calculateSmsMetrics(text) {
  const content = String(text || '');
  if (!content) {
    return {
      character_count: 0,
      is_unicode: false,
      parts_count: 1,
      carrier_warning: null
    };
  }

  const rawGlyphCount = Array.from(content).length;
  const isUnicode = !GSM_7_REGEX.test(content);

  let effectiveCharCount = 0;
  let partsCount = 1;

  if (isUnicode) {
    effectiveCharCount = rawGlyphCount;
    if (effectiveCharCount <= 70) {
      partsCount = 1;
    } else {
      partsCount = Math.ceil(effectiveCharCount / 67);
    }
  } else {
    for (const ch of content) {
      effectiveCharCount += GSM_7_EXTENDED_CHARS.has(ch) ? 2 : 1;
    }
    if (effectiveCharCount <= 160) {
      partsCount = 1;
    } else {
      partsCount = Math.ceil(effectiveCharCount / 153);
    }
  }

  partsCount = Math.max(1, partsCount || 1);

  let carrierWarning = null;
  if (partsCount >= 5) {
    carrierWarning = `High Segment Warning: Message requires ${partsCount} SMS parts (${partsCount} credits per number). Carriers may throttle or drop messages exceeding 4 parts.`;
  }

  return {
    character_count: effectiveCharCount,
    is_unicode: isUnicode,
    parts_count: partsCount,
    carrier_warning: carrierWarning
  };
}

/**
 * Standard Email Pattern and Validation
 */
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_PATTERN.test(email.trim().toLowerCase());
}

/**
 * Sanitize a string to prevent CSV / Spreadsheet formula injection (=, +, -, @, tab, CR).
 * @param {any} val
 * @returns {string} Escaped CSV cell enclosed in quotes
 */
function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Strict validator for media/attachment URLs.
 * Rejects javascript:, data:, quotes, angle brackets, semicolons, and code breakout payloads.
 * @param {string} url
 * @returns {boolean}
 */
function isValidAttachmentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/api/campaigns/files/')) {
    return /^\/api\/campaigns\/files\/[a-zA-Z0-9._-]+$/i.test(trimmed);
  }
  if (trimmed.startsWith('/api/resellers/logo/')) {
    return /^\/api\/resellers\/logo\/[a-zA-Z0-9._-]+$/i.test(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (/['"`<>;\\\s]/.test(trimmed)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  GSM_7_REGEX,
  GSM_7_EXTENDED_CHARS,
  SMPP_DELIVERED_STATUSES,
  SMPP_FAILED_STATUSES,
  EMAIL_PATTERN,
  isValidEmail,
  isValidAttachmentUrl,
  normalizePhoneNumber,
  calculateSmsMetrics,
  sanitizeCsvCell
};

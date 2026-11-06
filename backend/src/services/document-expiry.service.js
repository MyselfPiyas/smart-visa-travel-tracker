const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_EXPIRY_WARNING_THRESHOLDS = Object.freeze([90, 60, 30]);

/**
 * User-entered dates are calendar dates, not moments in a time zone. The API
 * stores them at UTC midnight, and this module compares their UTC calendar
 * portions so display locale and daylight-saving changes cannot shift a day.
 */
export function parseCalendarDate(value) {
  if (value == null || value === '') return { value: null, missing: true, valid: true };
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return { value: null, missing: false, valid: false };
    return { value: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())), missing: false, valid: true };
  }
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return { value: null, missing: false, valid: false };
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { value: null, missing: false, valid: false };
    return { value: date, missing: false, valid: true };
  }
  return { value: null, missing: false, valid: false };
}

export function getExpiryWarningThresholds(value = process.env.DOCUMENT_EXPIRY_WARNING_DAYS) {
  const parsed = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : DEFAULT_EXPIRY_WARNING_THRESHOLDS;
  const thresholds = parsed.map(Number).filter((item) => Number.isInteger(item) && item > 0 && item <= 365);
  return [...new Set(thresholds.length ? thresholds : DEFAULT_EXPIRY_WARNING_THRESHOLDS)].sort((a, b) => b - a);
}

export function startOfUtcDay(value = new Date()) {
  const parsed = parseCalendarDate(value);
  return parsed.value || new Date(NaN);
}

export function getExpiryBoundaries(now = new Date(), thresholds = getExpiryWarningThresholds()) {
  const today = startOfUtcDay(now);
  const warningDays = Math.max(...getExpiryWarningThresholds(thresholds));
  return { today, warningDays, warningEndExclusive: new Date(today.getTime() + (warningDays + 1) * DAY_MS) };
}

function calculateRemainingDays(expiryDate, today) {
  return Math.round((expiryDate.getTime() - today.getTime()) / DAY_MS);
}

/** Single source of truth used by APIs, dashboard summaries, and jobs. */
export function getDocumentExpiryDetails(document, now = new Date(), thresholds = getExpiryWarningThresholds()) {
  const statusStored = document?.status;
  if (statusStored === 'archived') return { status: 'archived', remainingDays: null, warningThresholdDays: null, expiryDate: null, validFrom: null, message: 'This document is archived.' };

  const expiry = parseCalendarDate(document?.expiryDate ?? document?.validUntil);
  const isVisa = document?.documentType === 'visa';
  const validFrom = isVisa ? parseCalendarDate(document?.validFrom) : { missing: true, valid: true, value: null };
  const todayParsed = parseCalendarDate(now);
  if (!todayParsed.valid || !todayParsed.value) return { status: 'pending_information', remainingDays: null, warningThresholdDays: null, expiryDate: null, validFrom: null, message: 'Expiry status is unavailable because the reference date is invalid.' };

  if (!expiry.valid || (isVisa && !validFrom.valid)) return { status: 'pending_information', remainingDays: null, warningThresholdDays: null, expiryDate: null, validFrom: null, dateIssue: 'invalid', message: 'Check the document dates; one or more dates are invalid.' };
  if (expiry.missing || (isVisa && validFrom.missing)) return { status: 'pending_information', remainingDays: null, warningThresholdDays: null, expiryDate: expiry.value, validFrom: validFrom.value, dateIssue: 'missing', message: isVisa ? 'Add the visa valid-from and valid-until dates.' : 'Add an expiry date to calculate validity.' };
  if (validFrom.value && expiry.value < validFrom.value) return { status: 'pending_information', remainingDays: null, warningThresholdDays: null, expiryDate: expiry.value, validFrom: validFrom.value, dateIssue: 'invalid_range', message: 'The expiry date is earlier than the valid-from date.' };

  const today = todayParsed.value;
  const remainingDays = calculateRemainingDays(expiry.value, today);
  if (isVisa && validFrom.value > today) return { status: 'not_yet_valid', remainingDays, warningThresholdDays: null, expiryDate: expiry.value, validFrom: validFrom.value, message: `This visa becomes valid in ${calculateRemainingDays(validFrom.value, today)} day(s).` };
  if (expiry.value < today) return { status: 'expired', remainingDays, warningThresholdDays: null, expiryDate: expiry.value, validFrom: validFrom.value, message: `Expired ${Math.abs(remainingDays)} day(s) ago.` };

  const warningThresholds = getExpiryWarningThresholds(thresholds);
  const warningThresholdDays = warningThresholds.filter((days) => remainingDays <= days).at(-1) || null;
  if (warningThresholdDays) return { status: 'expiring_soon', remainingDays, warningThresholdDays, expiryDate: expiry.value, validFrom: validFrom.value, message: remainingDays === 0 ? 'Expires today.' : `Expires in ${remainingDays} day(s).` };
  return { status: 'valid', remainingDays, warningThresholdDays: null, expiryDate: expiry.value, validFrom: validFrom.value, message: `Expires in ${remainingDays} day(s).` };
}

export function getExpiryDateFilter(status, now = new Date(), thresholds = getExpiryWarningThresholds()) {
  const { today, warningEndExclusive } = getExpiryBoundaries(now, thresholds);
  if (status === 'expired') return { expiryDate: { $lt: today } };
  if (status === 'expiring_soon') return { expiryDate: { $gte: today, $lt: warningEndExclusive } };
  if (status === 'valid') return { expiryDate: { $gte: warningEndExclusive } };
  if (status === 'pending_information') return { $or: [{ expiryDate: null }, { expiryDate: { $exists: false } }, { documentType: 'visa', $or: [{ validFrom: null }, { validFrom: { $exists: false } }] }] };
  return {};
}

export { DAY_MS };

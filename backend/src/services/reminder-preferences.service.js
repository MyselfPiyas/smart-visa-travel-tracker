import { isValidTimeZone } from '../utils/calendar-timezone.js';

export const SUPPORTED_EXPIRY_INTERVALS = Object.freeze([90, 60, 30, 0]);
export const DEFAULT_REMINDER_PREFERENCES = Object.freeze({
  enabled: true,
  emailEnabled: true,
  expiryIntervals: [...SUPPORTED_EXPIRY_INTERVALS],
  expiredDocumentWarnings: true,
  potentialOverstayWarnings: true,
  importantDocumentInformation: true,
  timeZone: 'UTC',
});

export function readReminderPreferences(user) {
  const value = user?.reminderPreferences || {};
  const intervals = Array.isArray(value.expiryIntervals)
    ? value.expiryIntervals.filter((day) => SUPPORTED_EXPIRY_INTERVALS.includes(day))
    : Array.isArray(value.daysBeforeExpiry)
      ? value.daysBeforeExpiry.filter((day) => SUPPORTED_EXPIRY_INTERVALS.includes(day))
      : [...SUPPORTED_EXPIRY_INTERVALS];
  return {
    enabled: value.enabled !== false,
    emailEnabled: value.emailEnabled !== false,
    expiryIntervals: [...new Set(intervals)],
    expiredDocumentWarnings: value.expiredDocumentWarnings !== false,
    potentialOverstayWarnings: value.potentialOverstayWarnings !== false,
    importantDocumentInformation: value.importantDocumentInformation !== false,
    timeZone: isValidTimeZone(user?.profileSettings?.timeZone) ? user.profileSettings.timeZone : 'UTC',
  };
}

export function documentReminderIntervals(document, preferences) {
  if (document?.reminderPreferences?.enabled === false) return [];
  const userIntervals = preferences.expiryIntervals;
  const override = document?.reminderPreferences?.daysBeforeExpiry;
  if (!Array.isArray(override)) return userIntervals;
  return userIntervals.filter((day) => override.includes(day));
}

export function notificationAllowed(type, preferences, offsetDays = null) {
  if (!preferences.enabled || !preferences.emailEnabled) return false;
  if (type === 'expired_document_warning') return preferences.expiredDocumentWarnings;
  if (type === 'potential_overstay_warning') return preferences.potentialOverstayWarnings;
  if (type === 'important_document_information') return preferences.importantDocumentInformation;
  if (offsetDays !== null) return preferences.expiryIntervals.includes(offsetDays);
  return true;
}

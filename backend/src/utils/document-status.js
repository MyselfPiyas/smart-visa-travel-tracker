import { getDocumentExpiryDetails, getExpiryWarningThresholds, startOfUtcDay } from '../services/document-expiry.service.js';

export const DOCUMENT_EXPIRING_SOON_DAYS = Math.max(...getExpiryWarningThresholds());
export const DOCUMENT_STATUS_CUTOFF_DAYS = DOCUMENT_EXPIRING_SOON_DAYS + 1;

/** Backwards-compatible status helper; date decisions live in the expiry service. */
export function getDocumentStatus(document, now = new Date()) {
  return getDocumentExpiryDetails(document, now).status;
}

export { startOfUtcDay };

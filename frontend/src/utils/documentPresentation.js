export const documentTypeLabels = {
  passport: 'Passport',
  visa: 'Visa',
  travel_insurance: 'Travel insurance',
  vaccination_certificate: 'Vaccination certificate',
  residence_permit: 'Residence permit',
  other: 'Other travel document',
};

export function formatDocumentDate(value) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

export function getStatusTone(status) {
  return ({ valid: 'success', expiring_soon: 'warning', expired: 'danger', pending_information: 'neutral', not_yet_valid: 'info', archived: 'neutral' })[status] || 'neutral';
}

export function getStatusLabel(status) {
  return ({ valid: 'Valid', expiring_soon: 'Expiring soon', expired: 'Expired', pending_information: 'Pending information', not_yet_valid: 'Not yet valid', archived: 'Archived' })[status] || 'Unknown';
}

export function formatRemainingDays(days, status) {
  if (days == null) return status === 'pending_information' ? 'Add dates for a validity estimate' : 'No expiry date';
  if (status === 'expired') return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (status === 'not_yet_valid') return `Valid in ${days} day${days === 1 ? '' : 's'}`;
  if (days === 0) return 'Expires today';
  return `${days} day${days === 1 ? '' : 's'} remaining`;
}

export const statusExplanations = {
  valid: 'Outside the configured expiry warning window. This does not confirm entry eligibility.',
  expiring_soon: 'Expiry is within the configured warning window. Check renewal requirements.',
  expired: 'The expiry date has passed. Verify the document before travel.',
  pending_information: 'Required date information is missing or invalid.',
  not_yet_valid: 'This visa’s valid-from date is in the future.',
};

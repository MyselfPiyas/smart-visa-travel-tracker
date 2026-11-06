export const travelPurposeLabels = {
  tourism: 'Tourism', business: 'Business', education: 'Education', employment: 'Employment',
  family_visit: 'Family visit', medical: 'Medical', transit: 'Transit', other: 'Other',
  study: 'Education', work: 'Employment', family: 'Family visit',
};

const countryNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export function formatCountry(code) {
  if (!code) return 'Unknown destination';
  try { return countryNames?.of(code.toUpperCase()) || code.toUpperCase(); } catch { return code.toUpperCase(); }
}

export function formatTravelDate(value) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

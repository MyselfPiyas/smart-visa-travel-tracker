import nodemailer from 'nodemailer';

const documentLabels = {
  passport: 'Passport', visa: 'Visa', travel_insurance: 'Travel insurance',
  vaccination_certificate: 'Vaccination certificate', residence_permit: 'Residence permit', other: 'Other travel document',
};

const copy = {
  expiry_90_day: ['90-day document reminder', 'Your document expires in about 90 days. Review renewal timelines and destination requirements.'],
  expiry_60_day: ['60-day document reminder', 'Your document expires in about 60 days. Check renewal steps and processing times.'],
  expiry_30_day: ['30-day document reminder', 'Your document expires in about 30 days. Please review renewal steps soon.'],
  expiry_day: ['Document expires today', 'The recorded expiry date is today. Verify the date and avoid relying on an expired document.'],
  expired_document_warning: ['Document expiry notice', 'The recorded expiry date has passed. Verify the document before planning travel.'],
  potential_overstay_warning: ['Please review a travel record', 'A planned return or recorded stay date has passed without a recorded exit. Review your travel record and verify the applicable rules.'],
  important_document_information: ['Document information needs attention', 'A travel document is missing expiry information, so the tracker cannot calculate its validity.'],
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function safeDisplayName(value = 'Travel document') {
  // Display labels are user-entered, so redact long identifier-shaped tokens.
  return String(value).replace(/\b[A-Z0-9]{6,}\b/gi, '[redacted]').slice(0, 120) || 'Travel document';
}

function formattedDate(value) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return 'Not recorded';
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value));
}

export function buildNotificationEmail({ user, notification, document = null, travel = null, remainingDays = null, appUrl = process.env.APP_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }) {
  const [subject, defaultBody] = copy[notification.type] || ['Travel document update', 'Review your travel document workspace for details.'];
  const safeName = escapeHtml(user.name || 'traveler');
  const date = formattedDate(notification.expiryDateSnapshot || document?.expiryDate);
  const type = documentLabels[document?.documentType] || 'Travel document';
  const displayName = safeDisplayName(document?.displayName);
  const destination = escapeHtml(travel?.destinationCountry || 'your destination');
  const returnDate = formattedDate(travel?.returnDate);
  let action = 'Review your document details and verify destination requirements with official sources.';
  if (notification.type === 'potential_overstay_warning') action = `Review the trip to ${destination}, update its exit information if appropriate, and verify destination-specific rules with official sources.`;
  else if (notification.type === 'important_document_information') action = 'Add or correct the missing expiry information in your dashboard.';
  else if (notification.type === 'expired_document_warning') action = 'Renew the document if needed and verify its current validity before travel.';
  else if (notification.type === 'expiry_day') action = 'Verify the recorded date and contact the issuing authority about renewal or replacement.';
  const details = notification.type === 'potential_overstay_warning'
    ? `<p><strong>Destination:</strong> ${destination}</p><p><strong>Planned return:</strong> ${escapeHtml(returnDate)}</p>`
    : notification.type === 'important_document_information'
      ? `<p><strong>Document:</strong> ${displayName} (${escapeHtml(type)})</p><p><strong>Expiry date:</strong> Not recorded</p>`
      : `<p><strong>Document:</strong> ${displayName} (${escapeHtml(type)})</p><p><strong>Recorded expiry date:</strong> ${escapeHtml(date)}</p>`;
  const link = new URL('/app/dashboard', appUrl).toString();
  const intro = notification.type === 'potential_overstay_warning'
    ? 'This is an informational alert based on user-entered travel dates. It is not a legal determination of overstay or immigration eligibility.'
    : notification.type === 'important_document_information'
      ? defaultBody
      : notification.type === 'expired_document_warning'
        ? `${defaultBody} Days expired: ${remainingDays == null ? 'not available' : Math.abs(remainingDays)}.`
        : `${defaultBody} Days remaining: ${remainingDays ?? 0}.`;
  const text = `Hello ${user.name || 'traveler'},\n\n${subject}\n${intro}\n\n${notification.type === 'potential_overstay_warning' ? `Destination: ${travel?.destinationCountry || 'Not recorded'}\nPlanned return: ${returnDate}` : `Document: ${safeDisplayName(document?.displayName)} (${type})\nRecorded expiry date: ${notification.type === 'important_document_information' ? 'Not recorded' : date}` }\n\nRecommended next action: ${action}\n\nOpen your dashboard: ${link}\n\nTravel and immigration rules differ by country. Confirm requirements using official sources.\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#152b2a"><main style="max-width:600px;margin:32px auto;background:#fff;border:1px solid #dce7e5;border-radius:16px;padding:32px"><p style="margin:0 0 20px;color:#0f766e;font-weight:700">WAYFARER · TRAVEL DOCUMENT TRACKER</p><h1 style="font-size:22px">${escapeHtml(subject)}</h1><p>Hello ${safeName},</p><p>${escapeHtml(intro)}</p>${details}<div style="margin:24px 0;padding:16px;background:#f0fdfa;border-radius:12px"><strong>Recommended next action</strong><p>${escapeHtml(action)}</p></div><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#115e59;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px">Open your dashboard</a></p><p style="font-size:12px;line-height:1.6;color:#64748b">Immigration rules differ by country. These alerts use user-entered information and do not determine legal overstay or entry eligibility. Verify requirements with official sources.</p></main></body></html>`;
  return { subject: `Smart Visa Tracker: ${subject}`, text, html };
}

export function createSmtpTransport(env = process.env) {
  const host = env.SMTP_HOST?.trim();
  const port = Number(env.SMTP_PORT) || 587;
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASSWORD;
  const from = env.SMTP_FROM?.trim();
  if (!host || !from || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error('SMTP settings are incomplete.');
    error.code = 'SMTP_CONFIGURATION_MISSING';
    throw error;
  }
  return { transport: nodemailer.createTransport({ host, port, secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465, auth: { user, pass } }), from };
}

export function isValidFromAddress(value) {
  if (typeof value !== 'string') return false;
  const match = /<([^<>]+)>\s*$/.exec(value.trim());
  const address = (match ? match[1] : value).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && address.length <= 254;
}

export { documentLabels };

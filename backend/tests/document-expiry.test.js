import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocumentExpiryDetails, getExpiryWarningThresholds, parseCalendarDate } from '../src/services/document-expiry.service.js';
import { createExpiryTrackingService } from '../src/services/expiry-tracking.service.js';

const today = new Date('2026-11-04T17:45:00.000Z');
const expiresIn = (days) => new Date(Date.UTC(2026, 10, 4 + days));

test('configurable warning days accept comma separated positive unique whole numbers', () => {
  assert.deepEqual(getExpiryWarningThresholds('90,60,30,30,0,400,3.2'), [90, 60, 30]);
  assert.deepEqual(getExpiryWarningThresholds('invalid'), [90, 60, 30]);
});

test('expiry thresholds consistently include the 90, 60, and 30 day dates', () => {
  for (const days of [90, 60, 30]) {
    const result = getDocumentExpiryDetails({ expiryDate: expiresIn(days) }, today);
    assert.equal(result.status, 'expiring_soon');
    assert.equal(result.remainingDays, days);
  }
  assert.equal(getDocumentExpiryDetails({ expiryDate: expiresIn(91) }, today).status, 'valid');
  assert.equal(getDocumentExpiryDetails({ expiryDate: expiresIn(45) }, today).warningThresholdDays, 60);
});

test('today, tomorrow, and yesterday use inclusive UTC calendar-day comparisons', () => {
  assert.deepEqual([1, 0].map((days) => getDocumentExpiryDetails({ expiryDate: expiresIn(days) }, today).status), ['expiring_soon', 'expiring_soon']);
  assert.equal(getDocumentExpiryDetails({ expiryDate: expiresIn(-1) }, today).status, 'expired');
  assert.equal(getDocumentExpiryDetails({ expiryDate: expiresIn(-12) }, today).remainingDays, -12);
});

test('missing and invalid expiry dates are pending information', () => {
  assert.equal(getDocumentExpiryDetails({ expiryDate: null }, today).status, 'pending_information');
  assert.equal(getDocumentExpiryDetails({ expiryDate: '2026-02-30' }, today).dateIssue, 'invalid');
  assert.equal(getDocumentExpiryDetails({ expiryDate: new Date('invalid') }, today).status, 'pending_information');
  assert.equal(parseCalendarDate('2026-02-30').valid, false);
});

test('visa validity start, expiry, and entry fields are kept separate from expiry status', () => {
  const futureVisa = getDocumentExpiryDetails({ documentType: 'visa', validFrom: expiresIn(5), expiryDate: expiresIn(90), visaEntryType: 'multiple_entry' }, today);
  assert.equal(futureVisa.status, 'not_yet_valid');
  assert.equal(futureVisa.remainingDays, 90);
  assert.equal(getDocumentExpiryDetails({ documentType: 'visa', validFrom: expiresIn(-90), expiryDate: expiresIn(-1) }, today).status, 'expired');
  assert.equal(getDocumentExpiryDetails({ documentType: 'visa', validFrom: null, expiryDate: expiresIn(10) }, today).status, 'pending_information');
  assert.equal(getDocumentExpiryDetails({ documentType: 'visa', validFrom: expiresIn(10), expiryDate: expiresIn(5) }, today).dateIssue, 'invalid_range');
});

test('date-only values remain calendar dates independent of local timezone', () => {
  const priorTimezone = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Honolulu';
    const date = parseCalendarDate('2026-11-05').value;
    assert.equal(date.toISOString(), '2026-11-05T00:00:00.000Z');
    assert.equal(getDocumentExpiryDetails({ expiryDate: '2026-11-05' }, today).remainingDays, 1);
    process.env.TZ = 'Asia/Kolkata';
    assert.equal(getDocumentExpiryDetails({ expiryDate: '2026-11-05' }, today).remainingDays, 1);
  } finally { if (priorTimezone === undefined) delete process.env.TZ; else process.env.TZ = priorTimezone; }
});

test('open trips with no recorded exit generate informational review warnings from user-entered data', async () => {
  const owner = '507f1f77bcf86cd799439011';
  const visaId = '507f1f77bcf86cd799439012';
  const trips = [{ owner, destinationCountry: 'JP', departureDate: expiresIn(-100), actualEntryDate: expiresIn(-100), actualExitDate: null, returnDate: expiresIn(-2), visaDocument: visaId }];
  const visas = [{ _id: visaId, owner, documentType: 'visa', validFrom: expiresIn(-120), expiryDate: expiresIn(-10), allowedStayDays: 30 }];
  const simpleQuery = (rows) => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean() { return Promise.resolve(rows); } });
  const service = createExpiryTrackingService({
    DocumentModel: { find: () => simpleQuery(visas) },
    TravelHistoryModel: { find: () => simpleQuery(trips) },
    now: () => today,
  });
  const warnings = await service.getPotentialOverstayWarnings(owner);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].informationalOnly, true);
  assert.deepEqual(warnings[0].warnings.map((item) => item.type), ['expected_return_passed', 'recorded_stay_limit_passed', 'visa_validity_end_passed_during_open_trip']);
  assert.match(warnings[0].note, /not determine legal overstay/);
});

import mongoose from 'mongoose';
import TravelDocument from '../models/TravelDocument.js';
import TravelHistory from '../models/TravelHistory.js';
import {
  getDocumentExpiryDetails, getExpiryBoundaries, getExpiryWarningThresholds, startOfUtcDay,
} from './document-expiry.service.js';

const active = { status: { $ne: 'archived' } };

function merge(...filters) { return Object.assign({}, ...filters); }

export function createExpiryTrackingService({
  DocumentModel = TravelDocument,
  TravelHistoryModel = TravelHistory,
  now = () => new Date(),
  thresholds = () => getExpiryWarningThresholds(),
} = {}) {
  function serializeExpiry(document, current = now(), configured = thresholds()) {
    const details = getDocumentExpiryDetails(document, current, configured);
    return {
      displayName: document.displayName,
      documentType: document.documentType,
      expiryDate: details.expiryDate,
      ...(document.documentType === 'visa' ? { validUntil: details.expiryDate } : {}),
      validFrom: details.validFrom,
      status: details.status,
      remainingDays: details.remainingDays,
      warningThresholdDays: details.warningThresholdDays,
      visaEntryType: document.visaEntryType || null,
    };
  }

  async function getSummary(ownerId) {
    const current = now();
    const configured = thresholds();
    const { today, warningEndExclusive } = getExpiryBoundaries(current, configured);
    const owner = { owner: new mongoose.Types.ObjectId(ownerId) };
    const dateRequired = { $or: [{ expiryDate: null }, { expiryDate: { $exists: false } }, { documentType: 'visa', $or: [{ validFrom: null }, { validFrom: { $exists: false } }] }] };
    const visaNotYetValid = { documentType: 'visa', validFrom: { $gt: today }, expiryDate: { $gte: today } };
    const withValidStart = { $or: [{ documentType: { $ne: 'visa' } }, { validFrom: { $lte: today } }] };
    const [total, valid, expiringSoon, expired, pendingInformation, notYetValid, upcoming] = await Promise.all([
      DocumentModel.countDocuments(merge(owner, active)),
      DocumentModel.countDocuments(merge(owner, active, withValidStart, { expiryDate: { $gte: warningEndExclusive } })),
      DocumentModel.countDocuments(merge(owner, active, withValidStart, { expiryDate: { $gte: today, $lt: warningEndExclusive } })),
      DocumentModel.countDocuments(merge(owner, active, { expiryDate: { $lt: today } })),
      DocumentModel.countDocuments(merge(owner, active, dateRequired)),
      DocumentModel.countDocuments(merge(owner, active, visaNotYetValid)),
      DocumentModel.find(merge(owner, active, { expiryDate: { $gte: today, $lt: warningEndExclusive } }))
        .sort({ expiryDate: 1 }).limit(10).select('documentType displayName expiryDate validFrom visaEntryType allowedStayDays').lean(),
    ]);
    return {
      thresholds: configured,
      counts: { total, valid, expiringSoon, expired, pendingInformation, notYetValid },
      nextUpcomingExpiry: upcoming[0] ? serializeExpiry(upcoming[0], current, configured) : null,
      upcomingExpiries: upcoming.map((document) => serializeExpiry(document, current, configured)),
    };
  }

  async function getUpcoming(ownerId, withinDays = Math.max(...thresholds())) {
    const current = now();
    const today = startOfUtcDay(current);
    const cutoff = new Date(today.getTime() + (withinDays + 1) * 86400000);
    const docs = await DocumentModel.find({ owner: ownerId, ...active, expiryDate: { $gte: today, $lt: cutoff } })
      .sort({ expiryDate: 1 }).limit(100).select('documentType displayName expiryDate validFrom visaEntryType').lean();
    return docs.map((document) => serializeExpiry(document, current, thresholds()));
  }

  async function getExpired(ownerId) {
    const current = now();
    const today = startOfUtcDay(current);
    const docs = await DocumentModel.find({ owner: ownerId, ...active, expiryDate: { $lt: today } })
      .sort({ expiryDate: -1 }).limit(100).select('documentType displayName expiryDate validFrom visaEntryType').lean();
    return docs.map((document) => serializeExpiry(document, current, thresholds()));
  }

  async function getDocumentStatus(ownerId, documentId) {
    const document = await DocumentModel.findOne({ _id: documentId, owner: ownerId, ...active })
      .select('documentType displayName issueDate expiryDate validFrom visaEntryType allowedStayDays').lean();
    if (!document) return null;
    const details = getDocumentExpiryDetails(document, now(), thresholds());
    return { document: { displayName: document.displayName, documentType: document.documentType, issueDate: document.issueDate || null, expiryDate: document.expiryDate || null, validFrom: document.validFrom || null, visaEntryType: document.visaEntryType || null, allowedStayDays: document.allowedStayDays || null }, ...details };
  }

  async function getPotentialOverstayWarnings(ownerId) {
    const today = startOfUtcDay(now());
    const trips = await TravelHistoryModel.find({ owner: ownerId, departureDate: { $lte: today }, $or: [{ returnDate: { $lt: today }, actualExitDate: null }, { actualEntryDate: { $lte: today }, visaDocument: { $ne: null } }] })
      .sort({ returnDate: 1, actualEntryDate: 1 }).limit(100)
        .select('destinationCountry departureDate returnDate actualEntryDate actualExitDate visaDocument').lean();
    const visaIds = trips.map((trip) => trip.visaDocument).filter(Boolean);
    const visas = visaIds.length ? await DocumentModel.find({ _id: { $in: visaIds }, owner: ownerId, documentType: 'visa', ...active }).select('validFrom expiryDate allowedStayDays').lean() : [];
    const visasById = new Map(visas.map((visa) => [String(visa._id), visa]));
    return trips.map((trip) => {
      const warnings = [];
      if (trip.returnDate && startOfUtcDay(trip.returnDate) < today) warnings.push({ type: 'expected_return_passed', message: 'The planned return date has passed and no exit date is recorded. Please verify or update your travel record.' });
      const visa = trip.visaDocument && visasById.get(String(trip.visaDocument));
      if (trip.actualEntryDate && visa) {
        const entryDay = startOfUtcDay(trip.actualEntryDate);
        const validFrom = visa.validFrom && startOfUtcDay(visa.validFrom);
        const validUntil = visa.expiryDate && startOfUtcDay(visa.expiryDate);
        if ((validFrom && entryDay < validFrom) || (validUntil && entryDay > validUntil)) warnings.push({ type: 'recorded_entry_outside_visa_window', message: 'The recorded entry date falls outside the stored visa validity dates. Verify the dates and destination rules.' });
      }
      if (trip.actualEntryDate && !trip.actualExitDate && visa?.allowedStayDays) {
        const allowedThrough = new Date(startOfUtcDay(trip.actualEntryDate).getTime() + (visa.allowedStayDays - 1) * 86400000);
        if (allowedThrough < today) warnings.push({ type: 'recorded_stay_limit_passed', message: 'The recorded entry and visa stay limit indicate a date that has passed without a recorded exit. Verify the travel and visa details; this is not a legal determination.' });
      }
      if (trip.actualEntryDate && !trip.actualExitDate && visa?.expiryDate && startOfUtcDay(visa.expiryDate) < today) warnings.push({ type: 'visa_validity_end_passed_during_open_trip', message: 'The linked visa validity end date has passed while this trip has no recorded exit. Verify the entry, exit, and visa conditions for the destination.' });
      return {
        destinationCountry: trip.destinationCountry,
        expectedReturnDate: trip.returnDate || null,
        recordedEntryDate: trip.actualEntryDate || null,
        recordedExitDate: trip.actualExitDate || null,
        warnings,
        informationalOnly: true,
        note: 'Travel and immigration rules differ by country. Confirm details with official sources; this tracker cannot determine legal overstay or entry eligibility.',
      };
    }).filter((trip) => trip.warnings.length > 0);
  }

  return { getSummary, getUpcoming, getExpired, getDocumentStatus, getPotentialOverstayWarnings, serializeExpiry };
}

export default createExpiryTrackingService();

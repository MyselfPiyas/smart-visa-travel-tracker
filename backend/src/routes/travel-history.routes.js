import { Router } from 'express';
import mongoose from 'mongoose';
import TravelHistory from '../models/TravelHistory.js';
import TravelDocument from '../models/TravelDocument.js';
import AuditLog from '../models/AuditLog.js';
import { TRAVEL_PURPOSES } from '../models/enums.js';
import { recordAuditBestEffort } from '../services/audit.service.js';

const ALLOWED_FIELDS = new Set(['destinationCountry', 'purpose', 'departureDate', 'returnDate', 'actualEntryDate', 'actualExitDate', 'visaDocument', 'relatedDocuments', 'notes']);
const DATE_FIELDS = ['departureDate', 'returnDate', 'actualEntryDate', 'actualExitDate'];

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function validId(value, label = 'Travel record') {
  if (!mongoose.isValidObjectId(value)) throw httpError(400, `${label} reference is invalid.`);
}
function parseDate(value, field, required = false) {
  if (value === null || value === '') {
    if (required) throw httpError(400, `${field} is required.`);
    return null;
  }
  if (value === undefined) return undefined;
  if (typeof value !== 'string' && !(value instanceof Date)) throw httpError(400, `${field} must be a valid date.`);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (date.toISOString().slice(0, 10) !== value) throw httpError(400, `${field} must be a valid calendar date.`);
    return date;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw httpError(400, `${field} must be a valid date.`);
  return date;
}
function validateCombinations(record) {
  if (record.returnDate && record.returnDate < record.departureDate) throw httpError(400, 'Return date must be on or after departure date.');
  if (record.actualEntryDate && record.actualEntryDate < record.departureDate) throw httpError(400, 'Recorded entry date must be on or after departure date.');
  if (record.actualExitDate && record.actualEntryDate && record.actualExitDate < record.actualEntryDate) throw httpError(400, 'Recorded exit date must be on or after entry date.');
  if (record.actualEntryDate && record.returnDate && record.actualEntryDate > record.returnDate) throw httpError(400, 'Recorded entry date must be on or before the planned return date.');
  if (record.actualExitDate && record.returnDate && record.actualExitDate > record.returnDate) throw httpError(400, 'Recorded exit date must be on or before the planned return date.');
}
function safeReference(document) {
  if (!document || typeof document !== 'object') return null;
  return { id: String(document._id), displayName: document.displayName, documentType: document.documentType, validFrom: document.validFrom || null, expiryDate: document.expiryDate || null, visaEntryType: document.visaEntryType || null, allowedStayDays: document.allowedStayDays || null };
}
function safeRecord(record) {
  const visa = safeReference(record.visaDocument);
  const related = Array.isArray(record.relatedDocuments) ? record.relatedDocuments.map(safeReference).filter(Boolean) : [];
  return {
    id: String(record._id), destinationCountry: record.destinationCountry, purpose: record.purpose,
    departureDate: record.departureDate, returnDate: record.returnDate || null,
    actualEntryDate: record.actualEntryDate || null, actualExitDate: record.actualExitDate || null,
    visaDocument: visa, relatedDocuments: related, notes: record.notes || '', createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}
function recordQuery(Model, filter, owner) {
  return Model.findOne(filter)
    .populate({ path: 'visaDocument', select: 'displayName documentType validFrom expiryDate visaEntryType allowedStayDays', match: { owner, documentType: 'visa' } })
    .populate({ path: 'relatedDocuments', select: 'displayName documentType validFrom expiryDate visaEntryType allowedStayDays', match: { owner } });
}

export function createTravelHistoryRouter({ TravelHistoryModel = TravelHistory, DocumentModel = TravelDocument, AuditLogModel = AuditLog, now = () => new Date() } = {}) {
  const router = Router();

  async function validateReferences(owner, values) {
    const visa = values.visaDocument;
    if (visa) {
      validId(visa, 'Visa');
      const ownedVisa = await DocumentModel.findOne({ _id: visa, owner, documentType: 'visa' }).select('_id').lean();
      if (!ownedVisa) throw httpError(400, 'Choose a visa belonging to your account.');
    }
    const related = values.relatedDocuments || [];
    if (!Array.isArray(related) || related.length > 10 || related.some((id) => !mongoose.isValidObjectId(id))) throw httpError(400, 'Choose up to 10 valid related documents.');
    if (related.length) {
      const found = await DocumentModel.find({ _id: { $in: related }, owner }).select('_id').lean();
      if (found.length !== new Set(related.map(String)).size) throw httpError(400, 'All related documents must belong to your account.');
    }
  }

  function parseInput(body, { creating = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key))) throw httpError(400, 'Travel record contains unsupported fields.');
    const values = { ...body };
    if (values.destinationCountry !== undefined) {
      if (typeof values.destinationCountry !== 'string' || !/^[a-z]{2}$/i.test(values.destinationCountry.trim())) throw httpError(400, 'Destination must be a two-letter country code.');
      values.destinationCountry = values.destinationCountry.trim().toUpperCase();
    } else if (creating) throw httpError(400, 'Destination country is required.');
    if (values.purpose !== undefined && !TRAVEL_PURPOSES.includes(values.purpose)) throw httpError(400, 'Choose a supported travel purpose.');
    if (values.purpose === undefined && creating) throw httpError(400, 'Travel purpose is required.');
    for (const field of DATE_FIELDS) if (field in values) values[field] = parseDate(values[field], field, field === 'departureDate' && creating);
    if (creating && !values.departureDate) throw httpError(400, 'Departure date is required.');
    if (values.notes !== undefined && (typeof values.notes !== 'string' || values.notes.length > 2000)) throw httpError(400, 'Notes must be 2,000 characters or fewer.');
    if (values.visaDocument === '') values.visaDocument = null;
    if (values.relatedDocuments === null) values.relatedDocuments = [];
    return values;
  }

  router.post('/', async (req, res, next) => {
    try {
      const values = parseInput(req.body, { creating: true });
      validateCombinations(values);
      await validateReferences(req.user.id, values);
      const created = await TravelHistoryModel.create({ ...values, owner: req.user.id });
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'travel_history.created', resourceType: 'travel_history', resourceId: created._id, occurredAt: now(), metadata: { result: 'success', changedFields: ['travelRecord'] } });
      const record = await recordQuery(TravelHistoryModel, { _id: created._id, owner: req.user.id }, req.user.id).lean();
      return res.status(201).json({ record: safeRecord(record) });
    } catch (error) { return next(error); }
  });

  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 10));
      const filter = { owner: req.user.id };
      if (req.query.country) {
        if (typeof req.query.country !== 'string' || req.query.country.length > 2) throw httpError(400, 'Country filter must be one or two letters.');
        filter.destinationCountry = { $regex: `^${req.query.country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' };
      }
      if (req.query.purpose) {
        if (!TRAVEL_PURPOSES.includes(req.query.purpose)) throw httpError(400, 'Choose a supported travel purpose.');
        filter.purpose = req.query.purpose;
      }
      if (req.query.period && !['past', 'upcoming'].includes(req.query.period)) throw httpError(400, 'Period must be past or upcoming.');
      const today = new Date(`${now().toISOString().slice(0, 10)}T00:00:00.000Z`);
      if (req.query.period === 'past') filter.departureDate = { $lt: today };
      if (req.query.period === 'upcoming') filter.departureDate = { $gte: today };
      if (req.query.dateFrom || req.query.dateTo) {
        const range = filter.departureDate && typeof filter.departureDate === 'object' ? filter.departureDate : {};
        if (req.query.dateFrom) { const dateFrom = parseDate(req.query.dateFrom, 'dateFrom', true); range.$gte = range.$gte && range.$gte > dateFrom ? range.$gte : dateFrom; }
        if (req.query.dateTo) { const dateTo = parseDate(req.query.dateTo, 'dateTo', true); range.$lte = range.$lte && range.$lte < dateTo ? range.$lte : dateTo; }
        if (range.$gte && range.$lte && range.$gte > range.$lte) throw httpError(400, 'Start date must be on or before end date.');
        filter.departureDate = range;
      }
      if (req.query.sort && !['newest', 'oldest'].includes(req.query.sort)) throw httpError(400, 'Sort must be newest or oldest.');
      const sort = req.query.sort === 'oldest' ? 1 : -1;
      const [rows, total] = await Promise.all([
        TravelHistoryModel.find(filter).sort({ departureDate: sort, _id: sort }).skip((page - 1) * limit).limit(limit)
          .populate({ path: 'visaDocument', select: 'displayName documentType validFrom expiryDate visaEntryType allowedStayDays', match: { owner: req.user.id, documentType: 'visa' } })
          .populate({ path: 'relatedDocuments', select: 'displayName documentType validFrom expiryDate visaEntryType allowedStayDays', match: { owner: req.user.id } }).lean(),
        TravelHistoryModel.countDocuments(filter),
      ]);
      return res.json({ records: rows.map(safeRecord), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return next(error); }
  });

  router.get('/:recordId', async (req, res, next) => {
    try {
      validId(req.params.recordId);
      const record = await recordQuery(TravelHistoryModel, { _id: req.params.recordId, owner: req.user.id }, req.user.id).lean();
      if (!record) throw httpError(404, 'Travel record not found.');
      return res.json({ record: safeRecord(record) });
    } catch (error) { return next(error); }
  });

  router.patch('/:recordId', async (req, res, next) => {
    try {
      validId(req.params.recordId);
      const current = await TravelHistoryModel.findOne({ _id: req.params.recordId, owner: req.user.id });
      if (!current) throw httpError(404, 'Travel record not found.');
      const values = parseInput(req.body);
      if (Object.keys(values).length === 0) throw httpError(400, 'Provide at least one travel record field to update.');
      const merged = { ...current.toObject(), ...values };
      if (!merged.departureDate) throw httpError(400, 'Departure date is required.');
      validateCombinations(merged);
      await validateReferences(req.user.id, { visaDocument: merged.visaDocument, relatedDocuments: merged.relatedDocuments });
      Object.assign(current, values);
      await current.save();
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'travel_history.updated', resourceType: 'travel_history', resourceId: current._id, occurredAt: now(), metadata: { result: 'success', changedFields: ['travelRecord'] } });
      const record = await recordQuery(TravelHistoryModel, { _id: current._id, owner: req.user.id }, req.user.id).lean();
      return res.json({ record: safeRecord(record) });
    } catch (error) { return next(error); }
  });

  router.delete('/:recordId', async (req, res, next) => {
    try {
      validId(req.params.recordId);
      const deleted = await TravelHistoryModel.findOneAndDelete({ _id: req.params.recordId, owner: req.user.id });
      if (!deleted) throw httpError(404, 'Travel record not found.');
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'travel_history.deleted', resourceType: 'travel_history', resourceId: deleted._id, occurredAt: now(), metadata: { result: 'success' } });
      return res.json({ message: 'Travel record deleted.' });
    } catch (error) { return next(error); }
  });

  return router;
}

export default createTravelHistoryRouter();

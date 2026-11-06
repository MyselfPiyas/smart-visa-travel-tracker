import { Router } from 'express';
import mongoose from 'mongoose';
import DestinationRequirement from '../models/DestinationRequirement.js';
import TravelDocument from '../models/TravelDocument.js';
import AuditLog from '../models/AuditLog.js';
import { REQUIREMENT_TYPES, TRAVEL_PURPOSES } from '../models/enums.js';
import { createDestinationChecklistService } from '../services/destination-checklist.service.js';

const FIELDS = new Set(['destinationCountry', 'nationality', 'purpose', 'title', 'description', 'requirementType', 'officialSourceUrl', 'lastVerifiedAt', 'active']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function validCountry(value, field) { if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value)) throw httpError(400, `${field} must be a two-letter country code.`); return value.toUpperCase(); }
function dateOnly(value, field) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) throw httpError(400, `${field} must use YYYY-MM-DD format.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw httpError(400, `${field} must be a valid calendar date.`);
  return date;
}
function parseAdminBody(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !FIELDS.has(key))) throw httpError(400, 'Requirement contains unsupported fields.');
  const result = { ...body };
  if (!partial || 'destinationCountry' in result) result.destinationCountry = validCountry(result.destinationCountry, 'Destination country');
  if (!partial || 'nationality' in result) result.nationality = validCountry(result.nationality, 'Nationality');
  if ('purpose' in result && result.purpose !== 'any' && !TRAVEL_PURPOSES.includes(result.purpose)) throw httpError(400, 'Choose a supported travel purpose or any.');
  if (!partial && !('purpose' in result)) result.purpose = 'any';
  for (const field of ['title', 'description']) {
    if (field in result && (typeof result[field] !== 'string' || !result[field].trim() || result[field].length > (field === 'title' ? 160 : 3000))) throw httpError(400, `${field} is required and must be within the allowed length.`);
    if (!partial && !(field in result)) throw httpError(400, `${field} is required.`);
    if (field in result) result[field] = result[field].trim();
  }
  if ('requirementType' in result && !REQUIREMENT_TYPES.includes(result.requirementType)) throw httpError(400, 'Choose required, conditional, or informational.');
  if (!partial && !('requirementType' in result)) throw httpError(400, 'Requirement classification is required.');
  if ('officialSourceUrl' in result) {
    if (typeof result.officialSourceUrl !== 'string' || result.officialSourceUrl.length > 2048) throw httpError(400, 'Provide an HTTPS source URL.');
    try { const url = new URL(result.officialSourceUrl); if (url.protocol !== 'https:' || !url.hostname.includes('.')) throw new Error(); }
    catch { throw httpError(400, 'Provide an HTTPS source URL.'); }
  } else if (!partial) throw httpError(400, 'An official source URL is required.');
  if ('lastVerifiedAt' in result) result.lastVerifiedAt = dateOnly(result.lastVerifiedAt, 'Last verified date');
  else if (!partial) throw httpError(400, 'Last verified date is required.');
  if ('active' in result && typeof result.active !== 'boolean') throw httpError(400, 'Active must be true or false.');
  return result;
}
function requirementOutput(item, { includeUpdater = false } = {}) {
  const raw = typeof item.toObject === 'function' ? item.toObject() : item;
  return { id: String(raw._id), destinationCountry: raw.destinationCountry, nationality: raw.nationality, purpose: raw.purpose, title: raw.title, description: raw.description, requirementType: raw.requirementType, officialSourceUrl: raw.officialSourceUrl, lastVerifiedAt: raw.lastVerifiedAt || null, active: raw.active, updatedAt: raw.updatedAt, ...(includeUpdater ? { lastUpdatedBy: String(raw.lastUpdatedBy?._id || raw.lastUpdatedBy || '') } : {}) };
}
function parseFilters(query, { allowStatus = false } = {}) {
  const filter = {};
  if (query.destinationCountry) filter.destinationCountry = validCountry(query.destinationCountry, 'Destination country');
  if (query.nationality) filter.nationality = validCountry(query.nationality, 'Nationality');
  if (query.purpose) {
    if (query.purpose !== 'any' && !TRAVEL_PURPOSES.includes(query.purpose)) throw httpError(400, 'Choose a supported travel purpose.');
    filter.purpose = query.purpose;
  }
  if (allowStatus && query.active !== undefined) {
    if (!['true', 'false'].includes(query.active)) throw httpError(400, 'Active filter must be true or false.');
    filter.active = query.active === 'true';
  }
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.length > 80) throw httpError(400, 'Search text is too long.');
    const safe = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ destinationCountry: { $regex: safe, $options: 'i' } }, { nationality: { $regex: safe, $options: 'i' } }, { title: { $regex: safe, $options: 'i' } }];
  }
  return filter;
}

export function createTravelerDestinationRouter({ RequirementModel = DestinationRequirement, DocumentModel = TravelDocument, service = createDestinationChecklistService({ RequirementModel, DocumentModel }), now = () => new Date() } = {}) {
  const router = Router();
  router.get('/checklist', async (req, res, next) => {
    try {
      const destinationCountry = validCountry(req.query.destinationCountry, 'Destination country');
      const nationality = validCountry(req.query.nationality, 'Nationality');
      const purpose = req.query.purpose;
      if (!TRAVEL_PURPOSES.includes(purpose)) throw httpError(400, 'Choose a supported travel purpose.');
      const departureDate = dateOnly(req.query.departureDate, 'Departure date');
      const returnDate = dateOnly(req.query.returnDate, 'Return date');
      if (returnDate < departureDate) throw httpError(400, 'Return date must be on or after departure date.');
      return res.json(await service.buildChecklist({ owner: req.user.id, destinationCountry, nationality, purpose, departureDate, returnDate }));
    } catch (error) { return next(error); }
  });
  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
      const filters = parseFilters(req.query);
      const result = await service.listRequirements({ ...filters, destinationCountry: filters.destinationCountry, nationality: filters.nationality, purpose: filters.purpose, q: req.query.q, page, limit });
      return res.json(result);
    } catch (error) { return next(error); }
  });
  return router;
}

export function createAdminDestinationRouter({ RequirementModel = DestinationRequirement, AuditLogModel = AuditLog, now = () => new Date() } = {}) {
  const router = Router();
  async function audit(req, action, requirement, changedFields = []) {
    await AuditLogModel.create({ actor: req.user.id, action: `destination_requirement.${action}`, resourceType: 'destination_requirement', resourceId: String(requirement._id), occurredAt: now(), metadata: { result: 'success', changedFields: [...new Set(changedFields)] } });
  }
  router.get('/history', async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
      const filter = { resourceType: 'destination_requirement' };
      if (req.query.resourceId) filter.resourceId = String(req.query.resourceId).slice(0, 100);
      const rows = await AuditLogModel.find(filter).sort({ occurredAt: -1 }).limit(limit).select('actor action resourceId occurredAt metadata.changedFields').lean();
      return res.json({ items: rows.map((row) => ({ id: String(row._id), actor: String(row.actor || ''), action: row.action, resourceId: row.resourceId, occurredAt: row.occurredAt, changedFields: row.metadata?.changedFields || [] })) });
    } catch (error) { return next(error); }
  });
  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
      const filter = parseFilters(req.query, { allowStatus: true });
      const [items, total] = await Promise.all([RequirementModel.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), RequirementModel.countDocuments(filter)]);
      return res.json({ items: items.map((item) => requirementOutput(item, { includeUpdater: true })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return next(error); }
  });
  router.post('/', async (req, res, next) => {
    try {
      const values = parseAdminBody(req.body);
      const item = await RequirementModel.create({ ...values, lastUpdatedBy: req.user.id });
      await audit(req, 'created', item, ['destinationCountry', 'requirementStatus']);
      return res.status(201).json({ requirement: requirementOutput(item, { includeUpdater: true }) });
    } catch (error) { return next(error); }
  });
  router.patch('/:requirementId', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.requirementId)) throw httpError(400, 'Requirement reference is invalid.');
      const values = parseAdminBody(req.body, { partial: true });
      if (!Object.keys(values).length) throw httpError(400, 'Provide at least one field to update.');
      if (Object.keys(values).some((field) => field !== 'active') && !('lastVerifiedAt' in values)) throw httpError(400, 'Review the source and provide a last-verified date when editing requirement information.');
      const item = await RequirementModel.findById(req.params.requirementId);
      if (!item) throw httpError(404, 'Destination requirement not found.');
      Object.assign(item, values, { lastUpdatedBy: req.user.id });
      await item.save();
      await audit(req, values.active === false ? 'deactivated' : 'updated', item, Object.keys(values).map((field) => ({ destinationCountry: 'destinationCountry', nationality: 'nationality', purpose: 'purpose', title: 'requirementTitle', description: 'requirementDescription', requirementType: 'requirementType', officialSourceUrl: 'officialSourceUrl', lastVerifiedAt: 'lastVerifiedAt', active: 'active' })[field]));
      return res.json({ requirement: requirementOutput(item, { includeUpdater: true }) });
    } catch (error) { return next(error); }
  });
  router.patch('/:requirementId/deactivate', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.requirementId)) throw httpError(400, 'Requirement reference is invalid.');
      const item = await RequirementModel.findById(req.params.requirementId);
      if (!item) throw httpError(404, 'Destination requirement not found.');
      item.active = false; item.lastUpdatedBy = req.user.id; await item.save();
      await audit(req, 'deactivated', item, ['active']);
      return res.json({ requirement: requirementOutput(item, { includeUpdater: true }) });
    } catch (error) { return next(error); }
  });
  router.delete('/:requirementId', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.requirementId)) throw httpError(400, 'Requirement reference is invalid.');
      const item = await RequirementModel.findByIdAndDelete(req.params.requirementId);
      if (!item) throw httpError(404, 'Destination requirement not found.');
      await audit(req, 'deleted', item, ['active']);
      return res.json({ message: 'Destination requirement deleted.' });
    } catch (error) { return next(error); }
  });
  return router;
}

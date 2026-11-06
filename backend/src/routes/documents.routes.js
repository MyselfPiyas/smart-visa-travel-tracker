import { Router } from 'express';
import mongoose from 'mongoose';
import TravelDocument from '../models/TravelDocument.js';
import AuditLog from '../models/AuditLog.js';
import { DOCUMENT_TYPES } from '../models/enums.js';
import { documentUploadMiddleware, localDocumentStorage } from '../services/local-document-storage.js';
import { getDocumentExpiryDetails, getExpiryDateFilter, getExpiryWarningThresholds, startOfUtcDay } from '../services/document-expiry.service.js';
import { recordAuditBestEffort } from '../services/audit.service.js';

const allowedFields = new Set(['documentType', 'displayName', 'issuingCountry', 'issueDate', 'expiryDate', 'validFrom', 'visaEntryType', 'allowedStayDays']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VISA_ENTRY_TYPES = ['single_entry', 'multiple_entry'];

function createHttpError(status, message) { const error = new Error(message); error.status = status; return error; }
function parseDate(value, field) {
  if (value === '' || value === null) return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value)) throw createHttpError(400, `${field} must use YYYY-MM-DD format.`);
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.valueOf()) || result.toISOString().slice(0, 10) !== value) throw createHttpError(400, `${field} must be a valid calendar date.`);
  return result;
}

export function validateDocumentPayload(body, { partial = false, documentType: currentDocumentType } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createHttpError(400, 'Provide document information.');
  const keys = Object.keys(body);
  if (keys.some((key) => !allowedFields.has(key))) throw createHttpError(400, 'The request contains an unsupported document field.');
  const result = {};
  if (!partial || 'documentType' in body) {
    if (!DOCUMENT_TYPES.includes(body.documentType)) throw createHttpError(400, 'Choose a supported document type.');
    result.documentType = body.documentType;
  }
  if (!partial || 'displayName' in body) {
    if (typeof body.displayName !== 'string' || body.displayName.trim().length < 2 || body.displayName.trim().length > 120) throw createHttpError(400, 'Display name must be between 2 and 120 characters.');
    result.displayName = body.displayName.trim();
  }
  if ('issuingCountry' in body || !partial) {
    if (typeof body.issuingCountry !== 'string' || !/^[A-Za-z]{2}$/.test(body.issuingCountry.trim())) throw createHttpError(400, 'Use a two-letter issuing country code.');
    result.issuingCountry = body.issuingCountry.trim().toUpperCase();
  }
  if ('issueDate' in body) {
    result.issueDate = parseDate(body.issueDate, 'Issue date');
    if (result.issueDate && result.issueDate > startOfUtcDay(new Date())) throw createHttpError(400, 'Issue date cannot be in the future.');
  }
  if ('expiryDate' in body) result.expiryDate = parseDate(body.expiryDate, 'Expiry date');
  if ('validFrom' in body) result.validFrom = parseDate(body.validFrom, 'Visa valid-from date');
  if ('visaEntryType' in body) {
    if (!VISA_ENTRY_TYPES.includes(body.visaEntryType)) throw createHttpError(400, 'Choose single-entry or multiple-entry for a visa.');
    result.visaEntryType = body.visaEntryType;
  }
  if ('allowedStayDays' in body) {
    if (body.allowedStayDays === '' || body.allowedStayDays === null) result.allowedStayDays = undefined;
    else if (!Number.isInteger(Number(body.allowedStayDays)) || Number(body.allowedStayDays) < 1 || Number(body.allowedStayDays) > 730) throw createHttpError(400, 'Allowed stay must be a whole number from 1 to 730 days.');
    else result.allowedStayDays = Number(body.allowedStayDays);
  }
  const type = result.documentType || body.documentType || currentDocumentType;
  if (type !== 'visa' && ['validFrom', 'visaEntryType', 'allowedStayDays'].some((field) => field in body)) throw createHttpError(400, 'Visa validity fields can only be used for visa documents.');
  const issueDate = 'issueDate' in result ? result.issueDate : body.issueDate ? parseDate(body.issueDate, 'Issue date') : null;
  const expiryDate = 'expiryDate' in result ? result.expiryDate : body.expiryDate ? parseDate(body.expiryDate, 'Expiry date') : null;
  if (issueDate && expiryDate && expiryDate < issueDate) throw createHttpError(400, 'Expiry date must be on or after issue date.');
  const validFrom = 'validFrom' in result ? result.validFrom : body.validFrom ? parseDate(body.validFrom, 'Visa valid-from date') : null;
  if (validFrom && expiryDate && expiryDate < validFrom) throw createHttpError(400, 'Visa valid-until date must be on or after valid-from date.');
  return result;
}

function idOf(value) { return value?._id ? String(value._id) : String(value?.id || ''); }
function safeDate(value) { return value && !Number.isNaN(new Date(value).valueOf()) ? new Date(value) : null; }
function safeFile(file) {
  return { id: idOf(file), name: file.originalName, mimeType: file.metadata?.mimeType, sizeBytes: file.metadata?.sizeBytes, uploadedAt: file.uploadedAt };
}
export function serializeDocument(document, now = new Date()) {
  const raw = typeof document?.toObject === 'function' ? document.toObject() : document;
  const expiryDetails = getDocumentExpiryDetails(raw, now);
  return {
    id: idOf(raw), documentType: raw.documentType, displayName: raw.displayName,
    issuingCountry: raw.issuingCountry || null, issueDate: safeDate(raw.issueDate),
    expiryDate: safeDate(raw.expiryDate), validFrom: safeDate(raw.validFrom),
    ...(raw.documentType === 'visa' ? { validUntil: safeDate(raw.expiryDate) } : {}),
    visaEntryType: raw.visaEntryType || null, allowedStayDays: raw.allowedStayDays || null,
    status: expiryDetails.status, remainingDays: expiryDetails.remainingDays,
    warningThresholdDays: expiryDetails.warningThresholdDays, statusMessage: expiryDetails.message,
    files: (raw.files || []).map(safeFile), createdAt: raw.createdAt, updatedAt: raw.updatedAt,
  };
}

function validDocumentId(id) {
  if (!mongoose.isValidObjectId(id)) throw createHttpError(400, 'The document reference is invalid.');
}

function getObjectKeys(document) {
  const keys = (document.files || []).map((file) => file.objectKey).filter(Boolean);
  if (document.file?.objectKey) keys.push(document.file.objectKey);
  return keys;
}

function genericFileName(mimeType, index) {
  const extension = ({ 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' })[mimeType] || '.bin';
  return `Attachment ${index + 1}${extension}`;
}

function safeDownloadName(_storedName, mimeType) {
  return genericFileName(mimeType, 0);
}

export function createDocumentRouter({
  DocumentModel = TravelDocument,
  storage = localDocumentStorage,
  upload = documentUploadMiddleware,
  AuditLogModel = AuditLog,
  now = () => new Date(),
} = {}) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 10));
      const filter = { owner: req.user.id, status: { $ne: 'archived' } };
      if (req.query.documentType) {
        if (!DOCUMENT_TYPES.includes(req.query.documentType)) throw createHttpError(400, 'Choose a supported document type.');
        filter.documentType = req.query.documentType;
      }
      if (req.query.issuingCountry) {
        if (!/^[A-Za-z]{2}$/.test(req.query.issuingCountry)) throw createHttpError(400, 'Use a two-letter issuing country code.');
        filter.issuingCountry = req.query.issuingCountry.toUpperCase();
      }
      if (req.query.q !== undefined) {
        if (typeof req.query.q !== 'string' || req.query.q.length > 100) throw createHttpError(400, 'Search text is too long.');
        filter.displayName = { $regex: req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      }
      const status = req.query.expiryStatus;
      if (status) {
        if (['expired', 'expiring_soon', 'valid', 'pending_information'].includes(status)) Object.assign(filter, getExpiryDateFilter(status, now(), getExpiryWarningThresholds()));
        else if (status === 'not_yet_valid') { filter.validFrom = { $gt: startOfUtcDay(now()) }; filter.expiryDate = { $gte: startOfUtcDay(now()) }; filter.documentType = 'visa'; }
        else if (status !== 'all') throw createHttpError(400, 'Choose a supported expiry status.');
        if (['valid', 'expiring_soon'].includes(status)) filter.$or = [{ documentType: { $ne: 'visa' } }, { documentType: 'visa', validFrom: { $lte: startOfUtcDay(now()) } }];
      }
      const sortField = req.query.sort === 'createdAt' ? 'createdAt' : 'expiryDate';
      const direction = req.query.order === 'desc' ? -1 : 1;
      const [items, total] = await Promise.all([
        DocumentModel.find(filter).sort({ [sortField]: direction, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        DocumentModel.countDocuments(filter),
      ]);
      return res.json({ items: items.map((item) => serializeDocument(item, now())), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return next(error); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const values = validateDocumentPayload(req.body);
      const document = await DocumentModel.create({ ...values, owner: req.user.id, files: [] });
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'document.created', resourceType: 'travel_document', resourceId: document._id, occurredAt: now(), metadata: { result: 'success', changedFields: ['documentMetadata'] } });
      return res.status(201).json({ document: serializeDocument(document, now()) });
    } catch (error) { return next(error); }
  });

  router.get('/:documentId', async (req, res, next) => {
    try {
      validDocumentId(req.params.documentId);
      const document = await DocumentModel.findOne({ _id: req.params.documentId, owner: req.user.id, status: { $ne: 'archived' } }).select('+files.objectKey +file.objectKey').lean();
      if (!document) throw createHttpError(404, 'Document not found.');
      return res.json({ document: serializeDocument(document, now()) });
    } catch (error) { return next(error); }
  });

  router.get('/:documentId/status', async (req, res, next) => {
    try {
      validDocumentId(req.params.documentId);
      const document = await DocumentModel.findOne({ _id: req.params.documentId, owner: req.user.id, status: { $ne: 'archived' } }).select('documentType displayName issueDate expiryDate validFrom visaEntryType allowedStayDays').lean();
      if (!document) throw createHttpError(404, 'Document not found.');
      return res.json({ statusDetails: getDocumentExpiryDetails(document, now()), ...(document.documentType === 'visa' ? { validUntil: safeDate(document.expiryDate) } : {}) });
    } catch (error) { return next(error); }
  });

  // Status is calculated from current dates on every read; this endpoint
  // re-evaluates it without persisting a time-dependent status in MongoDB.
  router.post('/:documentId/recalculate-status', async (req, res, next) => {
    try {
      validDocumentId(req.params.documentId);
      const document = await DocumentModel.findOne({ _id: req.params.documentId, owner: req.user.id, status: { $ne: 'archived' } }).select('documentType displayName issueDate expiryDate validFrom visaEntryType allowedStayDays').lean();
      if (!document) throw createHttpError(404, 'Document not found.');
      return res.json({ statusDetails: getDocumentExpiryDetails(document, now()), ...(document.documentType === 'visa' ? { validUntil: safeDate(document.expiryDate) } : {}), recalculatedAt: now() });
    } catch (error) { return next(error); }
  });

  router.patch('/:documentId', async (req, res, next) => {
    try {
      validDocumentId(req.params.documentId);
      const document = await DocumentModel.findOne({ _id: req.params.documentId, owner: req.user.id, status: { $ne: 'archived' } });
      if (!document) throw createHttpError(404, 'Document not found.');
      const values = validateDocumentPayload(req.body, { partial: true, documentType: document.documentType });
      if (Object.keys(values).length === 0) throw createHttpError(400, 'Provide at least one document field to update.');
      if (document.documentType === 'visa' && values.documentType && values.documentType !== 'visa') {
        document.validFrom = null;
        document.visaEntryType = undefined;
        document.allowedStayDays = undefined;
      }
      Object.assign(document, values);
      await document.save();
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'document.updated', resourceType: 'travel_document', resourceId: document._id, occurredAt: now(), metadata: { result: 'success', changedFields: ['documentMetadata'] } });
      return res.json({ document: serializeDocument(document, now()) });
    } catch (error) { return next(error); }
  });

  router.post('/:documentId/files', upload, async (req, res, next) => {
    const uploaded = req.files || [];
    try {
      validDocumentId(req.params.documentId);
      if (!uploaded.length) throw createHttpError(400, 'Select at least one file to upload.');
      const document = await DocumentModel.findOne({ _id: req.params.documentId, owner: req.user.id, status: { $ne: 'archived' } }).select('+files.objectKey +file.objectKey');
      if (!document) throw createHttpError(404, 'Document not found.');
      const currentFiles = document.files || [];
      const maxFiles = storage.maxFiles || 5;
      if (currentFiles.length + uploaded.length > maxFiles) throw createHttpError(400, `A document may have at most ${maxFiles} attachments.`);
      const attachments = [];
      for (const file of uploaded) {
        const { checksumSha256 } = await storage.inspectUpload(file);
        attachments.push({
          storageProvider: storage.provider,
          objectKey: file.filename,
          // Never retain an untrusted user-supplied filename; it may contain
          // passport numbers or other personal details.
          originalName: genericFileName(file.mimetype, currentFiles.length + attachments.length),
          metadata: { mimeType: file.mimetype, sizeBytes: file.size, checksumSha256 },
          uploadedAt: now(),
        });
      }
      document.files.push(...attachments);
      await document.save();
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'document.file_uploaded', resourceType: 'travel_document', resourceId: document._id, occurredAt: now(), metadata: { result: 'success', changedFields: ['documentFile'] } });
      return res.status(201).json({ document: serializeDocument(document, now()) });
    } catch (error) {
      await Promise.all(uploaded.map((file) => storage.remove(file.filename).catch(() => {})));
      return next(error);
    }
  });

  router.get('/:documentId/files/:fileId', async (req, res, next) => {
    try {
      validDocumentId(req.params.documentId);
      validDocumentId(req.params.fileId);
      const document = await DocumentModel.findOne({ _id: req.params.documentId, owner: req.user.id, status: { $ne: 'archived' } }).select('+files.objectKey +file.objectKey').lean();
      const attachment = document?.files?.find((file) => idOf(file) === req.params.fileId);
      if (!attachment?.objectKey) throw createHttpError(404, 'Document file not found.');
      const mimeType = attachment.metadata?.mimeType;
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mimeType)) throw createHttpError(404, 'Document file not found.');
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'document.file_accessed', resourceType: 'travel_document', resourceId: document._id, occurredAt: now(), metadata: { result: 'success', changedFields: ['documentFile'] } });
      res.set({ 'Content-Type': mimeType, 'Content-Disposition': `attachment; filename="${safeDownloadName(attachment.originalName, mimeType)}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return storage.createReadStream(attachment.objectKey).on('error', (error) => next(error)).pipe(res);
    } catch (error) { return next(error); }
  });

  router.delete('/:documentId', async (req, res, next) => {
    try {
      validDocumentId(req.params.documentId);
      const document = await DocumentModel.findOne({ _id: req.params.documentId, owner: req.user.id, status: { $ne: 'archived' } }).select('+files.objectKey +file.objectKey');
      if (!document) throw createHttpError(404, 'Document not found.');
      const staged = await storage.prepareDelete(getObjectKeys(document));
      try {
        await DocumentModel.deleteOne({ _id: document._id, owner: req.user.id });
      } catch (error) {
        await staged.rollback();
        throw error;
      }
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'document.deleted', resourceType: 'travel_document', resourceId: document._id, occurredAt: now(), metadata: { result: 'success' } });
      await staged.commit();
      return res.status(204).end();
    } catch (error) { return next(error); }
  });

  return router;
}

export default createDocumentRouter();

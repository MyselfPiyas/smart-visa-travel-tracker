import { Router } from 'express';
import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { DELIVERY_STATUSES, NOTIFICATION_TYPES } from '../models/enums.js';
import { isValidTimeZone } from '../utils/calendar-timezone.js';
import { readReminderPreferences, SUPPORTED_EXPIRY_INTERVALS } from '../services/reminder-preferences.service.js';
import { NOTIFICATION_LABELS } from '../utils/notification-presentation.js';
import { recordAuditBestEffort } from '../services/audit.service.js';

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

function notificationResponse(row) {
  const document = row.relatedDocument && typeof row.relatedDocument === 'object' ? row.relatedDocument : null;
  return {
    id: String(row._id), type: row.type, title: NOTIFICATION_LABELS[row.type] || 'Travel document update',
    deliveryStatus: row.deliveryStatus, scheduledAt: row.scheduledAt, sentAt: row.sentAt || null,
    readAt: row.readAt || null, attemptCount: row.attemptCount || 0,
    deliveryIssue: row.deliveryStatus === 'failed' ? { category: row.safeError?.category || 'unknown' } : null,
    document: document ? { displayName: document.displayName, documentType: document.documentType, expiryDate: document.expiryDate || null } : null,
    createdAt: row.createdAt,
  };
}

function validObjectId(value) { if (!mongoose.isValidObjectId(value)) throw httpError(400, 'Notification reference is invalid.'); }

export function createTravelerNotificationRouter({ NotificationModel = Notification, UserModel = User, AuditLogModel = AuditLog, now = () => new Date() } = {}) {
  const router = Router();

  router.get('/preferences', async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.user.id).select('reminderPreferences profileSettings.timeZone').lean();
      if (!user) throw httpError(404, 'Account not found.');
      return res.json({ preferences: readReminderPreferences(user) });
    } catch (error) { return next(error); }
  });

  router.put('/preferences', async (req, res, next) => {
    try {
      const body = req.body;
      const allowed = new Set(['enabled', 'emailEnabled', 'expiryIntervals', 'expiredDocumentWarnings', 'potentialOverstayWarnings', 'importantDocumentInformation', 'timeZone']);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.has(key))) throw httpError(400, 'Unsupported reminder preference field.');
      for (const key of ['enabled', 'emailEnabled', 'expiredDocumentWarnings', 'potentialOverstayWarnings', 'importantDocumentInformation']) {
        if (key in body && typeof body[key] !== 'boolean') throw httpError(400, `${key} must be true or false.`);
      }
      if ('expiryIntervals' in body && (!Array.isArray(body.expiryIntervals) || body.expiryIntervals.some((day) => !SUPPORTED_EXPIRY_INTERVALS.includes(day)) || new Set(body.expiryIntervals).size !== body.expiryIntervals.length)) throw httpError(400, 'Choose any combination of 90, 60, 30, or 0-day reminders.');
      if ('timeZone' in body && (typeof body.timeZone !== 'string' || !isValidTimeZone(body.timeZone))) throw httpError(400, 'Choose a valid IANA timezone.');
      if (Object.keys(body).length === 0) throw httpError(400, 'Provide at least one preference to update.');

      const set = {};
      for (const field of ['enabled', 'emailEnabled', 'expiryIntervals', 'expiredDocumentWarnings', 'potentialOverstayWarnings', 'importantDocumentInformation']) if (field in body) set[`reminderPreferences.${field}`] = body[field];
      if ('timeZone' in body) set['profileSettings.timeZone'] = body.timeZone;
      const user = await UserModel.findByIdAndUpdate(req.user.id, { $set: set }, { new: true, runValidators: true }).select('reminderPreferences profileSettings.timeZone').lean();
      if (!user) throw httpError(404, 'Account not found.');
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'reminder_preferences.updated', resourceType: 'user', resourceId: req.user.id, occurredAt: now(), metadata: { result: 'success', changedFields: [Object.keys(body).includes('timeZone') && Object.keys(body).length === 1 ? 'timeZone' : 'reminderPreferences'] } });
      return res.json({ preferences: readReminderPreferences(user) });
    } catch (error) { return next(error); }
  });

  router.get('/upcoming', async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
      const items = await NotificationModel.find({ owner: req.user.id, deliveryStatus: { $in: ['pending', 'processing'] }, scheduledAt: { $gte: now() } })
        .sort({ scheduledAt: 1 }).limit(limit).select('type deliveryStatus scheduledAt sentAt readAt attemptCount relatedDocument createdAt')
        .populate({ path: 'relatedDocument', select: 'displayName documentType expiryDate', match: { owner: req.user.id } }).lean();
      return res.json({ items: items.map(notificationResponse) });
    } catch (error) { return next(error); }
  });

  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
      const filter = { owner: req.user.id };
      if (req.query.type) {
        if (!NOTIFICATION_TYPES.includes(req.query.type)) throw httpError(400, 'Choose a supported notification type.');
        filter.type = req.query.type;
      }
      if (req.query.status) {
        if (!DELIVERY_STATUSES.includes(req.query.status)) throw httpError(400, 'Choose a supported delivery status.');
        filter.deliveryStatus = req.query.status;
      }
      const [items, total] = await Promise.all([
        NotificationModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
          .select('type deliveryStatus scheduledAt sentAt readAt attemptCount safeError relatedDocument createdAt')
          .populate({ path: 'relatedDocument', select: 'displayName documentType expiryDate', match: { owner: req.user.id } }).lean(),
        NotificationModel.countDocuments(filter),
      ]);
      return res.json({ items: items.map(notificationResponse), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return next(error); }
  });

  router.get('/:notificationId', async (req, res, next) => {
    try {
      validObjectId(req.params.notificationId);
      const item = await NotificationModel.findOne({ _id: req.params.notificationId, owner: req.user.id })
        .select('type deliveryStatus scheduledAt sentAt readAt attemptCount safeError relatedDocument createdAt')
        .populate({ path: 'relatedDocument', select: 'displayName documentType expiryDate', match: { owner: req.user.id } }).lean();
      if (!item) throw httpError(404, 'Notification not found.');
      return res.json({ notification: notificationResponse(item) });
    } catch (error) { return next(error); }
  });

  router.patch('/:notificationId/read', async (req, res, next) => {
    try {
      validObjectId(req.params.notificationId);
      const item = await NotificationModel.findOneAndUpdate({ _id: req.params.notificationId, owner: req.user.id }, { $set: { readAt: now() } }, { new: true })
        .select('type deliveryStatus scheduledAt sentAt readAt attemptCount safeError relatedDocument createdAt')
        .populate({ path: 'relatedDocument', select: 'displayName documentType expiryDate', match: { owner: req.user.id } }).lean();
      if (!item) throw httpError(404, 'Notification not found.');
      return res.json({ notification: notificationResponse(item) });
    } catch (error) { return next(error); }
  });

  return router;
}

export function createAdminNotificationRouter({ NotificationModel = Notification } = {}) {
  const router = Router();
  router.get('/stats', async (_req, res, next) => {
    try {
      const [summary] = await NotificationModel.aggregate([{ $group: {
        _id: null, total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'pending'] }, 1, 0] } },
        processing: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'processing'] }, 1, 0] } },
        sent: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'sent'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'failed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'cancelled'] }, 1, 0] } },
        totalAttempts: { $sum: '$attemptCount' },
        retryAttempts: { $sum: { $cond: [{ $gt: ['$attemptCount', 1] }, { $subtract: ['$attemptCount', 1] }, 0] } },
      } }]);
      const data = summary || { total: 0, pending: 0, processing: 0, sent: 0, failed: 0, cancelled: 0, totalAttempts: 0, retryAttempts: 0 };
      return res.json({ totals: { pending: data.pending, processing: data.processing, sent: data.sent, failed: data.failed, cancelled: data.cancelled, totalAttempts: data.totalAttempts, retryAttempts: data.retryAttempts }, total: data.total });
    } catch (error) { return next(error); }
  });
  router.get('/failures', async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
      const [items, total] = await Promise.all([
        NotificationModel.find({ deliveryStatus: 'failed' }).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit)
          .select('type deliveryStatus attemptCount lastAttemptAt safeError createdAt updatedAt').lean(),
        NotificationModel.countDocuments({ deliveryStatus: 'failed' }),
      ]);
      return res.json({ items: items.map((item) => ({ id: String(item._id), type: item.type, title: NOTIFICATION_LABELS[item.type] || 'Travel document update', deliveryStatus: item.deliveryStatus, attemptCount: item.attemptCount, lastAttemptAt: item.lastAttemptAt, safeError: item.safeError || null, createdAt: item.createdAt, updatedAt: item.updatedAt })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return next(error); }
  });
  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
      const filter = {};
      if (req.query.status) {
        if (!DELIVERY_STATUSES.includes(req.query.status)) throw httpError(400, 'Choose a supported delivery status.');
        filter.deliveryStatus = req.query.status;
      }
      const [items, total] = await Promise.all([
        NotificationModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('type deliveryStatus attemptCount lastAttemptAt sentAt safeError createdAt updatedAt').lean(),
        NotificationModel.countDocuments(filter),
      ]);
      return res.json({ items: items.map((item) => ({ id: String(item._id), type: item.type, title: NOTIFICATION_LABELS[item.type] || 'Travel document update', deliveryStatus: item.deliveryStatus, attemptCount: item.attemptCount, lastAttemptAt: item.lastAttemptAt, sentAt: item.sentAt, safeError: item.safeError || null, createdAt: item.createdAt, updatedAt: item.updatedAt })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return next(error); }
  });
  return router;
}

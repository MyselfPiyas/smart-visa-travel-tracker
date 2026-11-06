import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import TravelDocument from '../models/TravelDocument.js';
import TravelHistory from '../models/TravelHistory.js';
import Notification from '../models/Notification.js';
import DestinationRequirement from '../models/DestinationRequirement.js';
import AuditLog from '../models/AuditLog.js';
import SupportQuery from '../models/SupportQuery.js';
import { getExpiryBoundaries, parseCalendarDate } from '../services/document-expiry.service.js';

function error(status, message) { const e = new Error(message); e.status = status; return e; }
function userView(user) { return { id: String(user._id), name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus, createdAt: user.createdAt, updatedAt: user.updatedAt, profileSettings: { displayName: user.profileSettings?.displayName || null, locale: user.profileSettings?.locale || 'en', timeZone: user.profileSettings?.timeZone || 'UTC' } }; }
function safeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function createAdminDashboardRouter({ UserModel = User, DocumentModel = TravelDocument, TravelHistoryModel = TravelHistory, NotificationModel = Notification, RequirementModel = DestinationRequirement, AuditLogModel = AuditLog, now = () => new Date() } = {}) {
  const router = Router();
  router.get('/summary', async (_req, res, next) => {
    try {
      const { today, warningEndExclusive } = getExpiryBoundaries(now());
      const [userStatsRows, documentStatsRows, totalTrips, notificationStatsRows, activeRequirements, recentActivity] = await Promise.all([
        UserModel.aggregate([{ $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$accountStatus', 'active'] }, 1, 0] } }, suspended: { $sum: { $cond: [{ $eq: ['$accountStatus', 'suspended'] }, 1, 0] } } } }]),
        DocumentModel.aggregate([{ $group: { _id: null, total: { $sum: { $cond: [{ $ne: ['$status', 'archived'] }, 1, 0] } }, expiringSoon: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'archived'] }, { $gte: ['$expiryDate', today] }, { $lt: ['$expiryDate', warningEndExclusive] }] }, 1, 0] } }, expired: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'archived'] }, { $eq: [{ $type: '$expiryDate' }, 'date'] }, { $lt: ['$expiryDate', today] }] }, 1, 0] } } } }]),
        TravelHistoryModel.countDocuments({}),
        NotificationModel.aggregate([{ $group: { _id: null, total: { $sum: 1 }, sent: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'sent'] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'failed'] }, 1, 0] } }, pending: { $sum: { $cond: [{ $in: ['$deliveryStatus', ['pending', 'processing']] }, 1, 0] } } } }]),
        RequirementModel.countDocuments({ active: true }),
        AuditLogModel.find({}).sort({ occurredAt: -1 }).limit(10).select('actor action resourceType resourceId occurredAt metadata.changedFields').lean(),
      ]);
      const users = userStatsRows[0] || { total: 0, active: 0, suspended: 0 };
      const documents = documentStatsRows[0] || { total: 0, expiringSoon: 0, expired: 0 };
      const notifications = notificationStatsRows[0] || { total: 0, sent: 0, failed: 0, pending: 0 };
      const resolved = notifications.sent + notifications.failed;
      return res.json({ users: { total: users.total, active: users.active, suspended: users.suspended }, documents: { total: documents.total, expiringSoon: documents.expiringSoon, expired: documents.expired }, travelHistory: { total: totalTrips }, notifications: { total: notifications.total, sent: notifications.sent, failed: notifications.failed, pending: notifications.pending, successRate: resolved ? Math.round(notifications.sent / resolved * 10000) / 100 : 0 }, destinationRequirements: { active: activeRequirements }, recentActivity: recentActivity.map((row) => ({ id: String(row._id), actor: row.actor ? String(row.actor) : null, action: row.action, resourceType: row.resourceType, resourceId: row.resourceId, occurredAt: row.occurredAt, changedFields: row.metadata?.changedFields || [] })) });
    } catch (e) { return next(e); }
  });
  router.get('/activity', async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
      const filter = {};
      if (req.query.from || req.query.to) { filter.occurredAt = {}; if (req.query.from) { const date = new Date(req.query.from); if (Number.isNaN(+date)) throw error(400, 'Start date is invalid.'); filter.occurredAt.$gte = date; } if (req.query.to) { const date = new Date(req.query.to); if (Number.isNaN(+date)) throw error(400, 'End date is invalid.'); date.setUTCHours(23,59,59,999); filter.occurredAt.$lte = date; } }
      const rows = await AuditLogModel.find(filter).sort({ occurredAt: -1 }).limit(limit).select('actor action resourceType resourceId occurredAt metadata.changedFields').lean();
      return res.json({ items: rows.map((row) => ({ id: String(row._id), actor: row.actor ? String(row.actor) : null, action: row.action, resourceType: row.resourceType, resourceId: row.resourceId, occurredAt: row.occurredAt, changedFields: row.metadata?.changedFields || [] })) });
    } catch (e) { return next(e); }
  });
  router.get('/compliance-summary', async (_req, res, next) => {
    try { const reviewAfterDays = Math.max(1, Math.min(730, Number.parseInt(process.env.DESTINATION_REQUIREMENT_STALE_DAYS, 10) || 180)); const [activeRequirements, staleRequirements, unverifiedRequirements] = await Promise.all([RequirementModel.countDocuments({ active: true }), RequirementModel.countDocuments({ active: true, lastVerifiedAt: { $lt: new Date(now().getTime() - reviewAfterDays * 86400000) } }), RequirementModel.countDocuments({ active: true, $or: [{ lastVerifiedAt: null }, { lastVerifiedAt: { $exists: false } }] })]); return res.json({ activeRequirements, staleRequirements, unverifiedRequirements, reviewAfterDays }); }
    catch (e) { return next(e); }
  });
  return router;
}

export function createAdminUserRouter({ UserModel = User, DocumentModel = TravelDocument, TravelHistoryModel = TravelHistory, AuditLogModel = AuditLog, now = () => new Date() } = {}) {
  const router = Router();
  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1)); const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
      const filter = { role: 'traveler' };
      if (req.query.createdFrom || req.query.createdTo) {
        filter.createdAt = {};
        if (req.query.createdFrom) { const parsed = parseCalendarDate(req.query.createdFrom); if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.createdFrom) || !parsed.valid) throw error(400, 'Start date is invalid.'); filter.createdAt.$gte = parsed.value; }
        if (req.query.createdTo) { const parsed = parseCalendarDate(req.query.createdTo); if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.createdTo) || !parsed.valid) throw error(400, 'End date is invalid.'); const date = parsed.value; date.setUTCHours(23,59,59,999); filter.createdAt.$lte = date; }
        if (filter.createdAt.$gte && filter.createdAt.$lte && filter.createdAt.$gte > filter.createdAt.$lte) throw error(400, 'Start date must be on or before end date.');
      }
      if (req.query.status) { if (!['pending','active','suspended'].includes(req.query.status)) throw error(400, 'Choose a supported account status.'); filter.accountStatus = req.query.status; }
      if (req.query.q !== undefined) { if (typeof req.query.q !== 'string' || req.query.q.length > 80) throw error(400, 'Search text is too long.'); const regex = safeRegex(req.query.q.trim()); filter.$or = [{ name: { $regex: regex, $options: 'i' } }, { email: { $regex: regex, $options: 'i' } }]; }
      const [users, total] = await Promise.all([UserModel.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).select('name email role accountStatus profileSettings.displayName profileSettings.locale profileSettings.timeZone createdAt updatedAt').lean(), UserModel.countDocuments(filter)]);
      return res.json({ users: users.map(userView), pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
    } catch (e) { return next(e); }
  });
  router.get('/:userId', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.userId)) throw error(400, 'Account reference is invalid.');
      const user = await UserModel.findOne({ _id: req.params.userId, role: 'traveler' }).select('name email role accountStatus profileSettings.displayName profileSettings.locale profileSettings.timeZone createdAt updatedAt').lean();
      if (!user) throw error(404, 'Traveler account not found.');
      const [documents, trips] = await Promise.all([DocumentModel.countDocuments({ owner: user._id, status: { $ne: 'archived' } }), TravelHistoryModel.countDocuments({ owner: user._id })]);
      return res.json({ user: userView(user), summary: { documents, trips } });
    } catch (e) { return next(e); }
  });
  router.patch('/:userId/status', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.userId)) throw error(400, 'Account reference is invalid.');
      if (!req.body || Object.keys(req.body).some((key) => key !== 'accountStatus') || !['active','suspended'].includes(req.body.accountStatus)) throw error(400, 'Choose active or suspended account status.');
      if (String(req.params.userId) === String(req.user.id) && req.body.accountStatus === 'suspended') throw error(400, 'You cannot suspend your own administrator account.');
      const user = await UserModel.findOne({ _id: req.params.userId, role: 'traveler' }); if (!user) throw error(404, 'Traveler account not found.');
      if (user.accountStatus === req.body.accountStatus) return res.json({ user: userView(user) });
      user.accountStatus = req.body.accountStatus; await user.save();
      await AuditLogModel.create({ actor: req.user.id, action: req.body.accountStatus === 'suspended' ? 'user.suspended' : 'user.reactivated', resourceType: 'user', resourceId: String(user._id), occurredAt: now(), metadata: { result: 'success', changedFields: ['accountStatus'] } });
      return res.json({ user: userView(user) });
    } catch (e) { return next(e); }
  });
  return router;
}

export function createAdminSupportRouter({ SupportModel = SupportQuery, AuditLogModel = AuditLog, now = () => new Date() } = {}) {
  const router = Router();
  const statuses = ['open', 'in_progress', 'waiting_for_user', 'resolved', 'closed', 'answered'];
  const supportView = (row) => ({
    id: String(row._id), user: row.user ? { id: String(row.user._id || row.user.id || row.user), name: row.user.name, email: row.user.email } : null,
    subject: row.subject, status: row.status,
    messages: Array.isArray(row.messages) && row.messages.length ? row.messages.map((entry) => ({ id: entry._id ? String(entry._id) : undefined, authorType: entry.authorType, message: entry.message, createdAt: entry.createdAt })) : [{ authorType: 'traveler', message: row.message, createdAt: row.createdAt }, ...(row.adminResponse?.message ? [{ authorType: 'admin', message: row.adminResponse.message, createdAt: row.adminResponse.respondedAt }] : [])],
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  });
  const validMessage = (value) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 5000 && !/<\/?[a-z][^>]*>/i.test(value);

  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
      const filter = {};
      if (req.query.status) { if (!statuses.includes(req.query.status)) throw error(400, 'Choose a supported support status.'); filter.status = req.query.status; }
      if (req.query.q !== undefined) {
        if (typeof req.query.q !== 'string' || req.query.q.trim().length > 80) throw error(400, 'Search text must be 80 characters or fewer.');
        const regex = safeRegex(req.query.q.trim());
        if (regex) filter.$or = [{ subject: { $regex: regex, $options: 'i' } }, { message: { $regex: regex, $options: 'i' } }, { 'messages.message': { $regex: regex, $options: 'i' } }];
      }
      const [rows, total] = await Promise.all([
        SupportModel.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).select('user subject message status adminResponse messages createdAt updatedAt').populate({ path: 'user', select: 'name email' }).lean(),
        SupportModel.countDocuments(filter),
      ]);
      return res.json({ items: rows.map(supportView), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (e) { return next(e); }
  });

  router.get('/:queryId', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.queryId)) throw error(400, 'Support request reference is invalid.');
      const row = await SupportModel.findById(req.params.queryId).select('user subject message status adminResponse messages createdAt updatedAt').populate({ path: 'user', select: 'name email' }).lean();
      if (!row) throw error(404, 'Support request not found.');
      return res.json({ query: supportView(row) });
    } catch (e) { return next(e); }
  });

  router.post('/:queryId/replies', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.queryId)) throw error(400, 'Support request reference is invalid.');
      if (!req.body || Object.keys(req.body).some((key) => !['message', 'status'].includes(key)) || !validMessage(req.body.message)) throw error(400, 'Reply must be 1 to 5000 characters and cannot contain HTML tags.');
      const status = req.body.status || 'waiting_for_user';
      if (!['waiting_for_user', 'in_progress', 'resolved'].includes(status)) throw error(400, 'Choose waiting for user, in progress, or resolved.');
      const row = await SupportModel.findById(req.params.queryId);
      if (!row) throw error(404, 'Support request not found.');
      const repliedAt = now();
      row.messages ||= [];
      row.messages.push({ authorType: 'admin', author: req.user.id, message: req.body.message.trim(), createdAt: repliedAt });
      row.adminResponse = { message: req.body.message.trim(), respondedBy: req.user.id, respondedAt: repliedAt };
      row.status = status;
      await row.save();
      await AuditLogModel.create({ actor: req.user.id, action: 'support.admin_replied', resourceType: 'support_query', resourceId: String(row._id), occurredAt: repliedAt, metadata: { result: 'success' } });
      return res.json({ query: supportView(row) });
    } catch (e) { return next(e); }
  });

  router.patch('/:queryId/status', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.queryId)) throw error(400, 'Support request reference is invalid.');
      if (!req.body || Object.keys(req.body).some((key) => key !== 'status') || !statuses.includes(req.body.status)) throw error(400, 'Choose a supported support status.');
      const row = await SupportModel.findById(req.params.queryId);
      if (!row) throw error(404, 'Support request not found.');
      const changed = row.status !== req.body.status;
      row.status = req.body.status;
      await row.save();
      if (changed) await AuditLogModel.create({ actor: req.user.id, action: 'support.status_updated', resourceType: 'support_query', resourceId: String(row._id), occurredAt: now(), metadata: { result: 'success', changedFields: ['supportStatus'] } });
      return res.json({ query: supportView(row) });
    } catch (e) { return next(e); }
  });
  return router;
}

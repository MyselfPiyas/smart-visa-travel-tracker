import { Router } from 'express';
import mongoose from 'mongoose';
import SupportQuery from '../models/SupportQuery.js';
import { SUPPORT_STATUSES } from '../models/enums.js';

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function validateText(value, min, max) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max && !/<\/?[a-z][^>]*>/i.test(value);
}
function queryView(row) {
  const messages = Array.isArray(row.messages) && row.messages.length
    ? row.messages
    : [{ authorType: 'traveler', author: row.user, message: row.message, createdAt: row.createdAt }, ...(row.adminResponse?.message ? [{ authorType: 'admin', author: row.adminResponse.respondedBy, message: row.adminResponse.message, createdAt: row.adminResponse.respondedAt }] : [])];
  return { id: String(row._id), subject: row.subject, status: row.status, messages: messages.map((entry) => ({ id: entry._id ? String(entry._id) : undefined, authorType: entry.authorType, message: entry.message, createdAt: entry.createdAt })), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function createTravelerSupportRouter({ SupportModel = SupportQuery } = {}) {
  const router = Router();
  router.get('/', async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
      const filter = { user: req.user.id };
      if (req.query.status) {
        if (!SUPPORT_STATUSES.includes(req.query.status)) throw httpError(400, 'Choose a supported support status.');
        filter.status = req.query.status;
      }
      const [rows, total] = await Promise.all([
        SupportModel.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).select('user subject message status adminResponse messages createdAt updatedAt').lean(),
        SupportModel.countDocuments(filter),
      ]);
      return res.json({ items: rows.map(queryView), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return next(error); }
  });
  router.post('/', async (req, res, next) => {
    try {
      const body = req.body || {};
      if (Object.keys(body).some((key) => !['subject', 'message'].includes(key))) throw httpError(400, 'Only a subject and message may be submitted.');
      if (!validateText(body.subject, 3, 160)) throw httpError(400, 'Subject must be 3 to 160 characters and cannot contain HTML tags.');
      if (!validateText(body.message, 5, 5000)) throw httpError(400, 'Message must be 5 to 5000 characters and cannot contain HTML tags.');
      const now = new Date();
      const row = await SupportModel.create({ user: req.user.id, subject: body.subject.trim(), message: body.message.trim(), status: 'open', messages: [{ authorType: 'traveler', author: req.user.id, message: body.message.trim(), createdAt: now }] });
      return res.status(201).json({ query: queryView(row) });
    } catch (error) { return next(error); }
  });
  router.get('/:queryId', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.queryId)) throw httpError(400, 'Support request reference is invalid.');
      const row = await SupportModel.findOne({ _id: req.params.queryId, user: req.user.id }).select('user subject message status adminResponse messages createdAt updatedAt').lean();
      if (!row) throw httpError(404, 'Support request not found.');
      return res.json({ query: queryView(row) });
    } catch (error) { return next(error); }
  });
  router.post('/:queryId/replies', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.queryId)) throw httpError(400, 'Support request reference is invalid.');
      if (!req.body || Object.keys(req.body).some((key) => key !== 'message') || !validateText(req.body.message, 1, 5000)) throw httpError(400, 'Reply must be 1 to 5000 characters and cannot contain HTML tags.');
      const row = await SupportModel.findOne({ _id: req.params.queryId, user: req.user.id });
      if (!row) throw httpError(404, 'Support request not found.');
      if (['closed', 'resolved'].includes(row.status)) throw httpError(409, 'This request is closed. Submit a new request if you still need help.');
      row.messages ||= [];
      row.messages.push({ authorType: 'traveler', author: req.user.id, message: req.body.message.trim(), createdAt: new Date() });
      row.status = 'in_progress';
      await row.save();
      return res.json({ query: queryView(row) });
    } catch (error) { return next(error); }
  });
  return router;
}

export default createTravelerSupportRouter();

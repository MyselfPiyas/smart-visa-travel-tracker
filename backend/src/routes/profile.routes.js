import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { isValidTimeZone } from '../utils/calendar-timezone.js';
import { recordAuditBestEffort } from '../services/audit.service.js';

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function profileView(user) {
  return {
    id: String(user._id), name: user.name, email: user.email, contactNumber: user.contactNumber || '',
    role: user.role, accountStatus: user.accountStatus,
    profileSettings: { displayName: user.profileSettings?.displayName || '', locale: user.profileSettings?.locale || 'en', timeZone: user.profileSettings?.timeZone || 'UTC' },
    createdAt: user.createdAt, updatedAt: user.updatedAt,
  };
}

export function createProfileRouter({ UserModel = User, AuditLogModel = AuditLog, bcryptImpl = bcrypt, passwordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: { message: 'Too many password attempts. Please try again later.' } } }), now = () => new Date() } = {}) {
  const router = Router();
  router.get('/', async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.user.id);
      if (!user) throw httpError(404, 'Profile not found.');
      return res.json({ profile: profileView(user) });
    } catch (error) { return next(error); }
  });

  router.patch('/', async (req, res, next) => {
    try {
      const allowed = ['name', 'contactNumber', 'displayName', 'locale', 'timeZone'];
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some((key) => !allowed.includes(key))) throw httpError(400, 'Only supported profile fields may be updated.');
      const body = req.body;
      const errors = {};
      if ('name' in body && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120)) errors.name = 'Enter a name between 1 and 120 characters.';
      if ('contactNumber' in body && (typeof body.contactNumber !== 'string' || body.contactNumber.length > 32 || (body.contactNumber.trim() && !/^\+?[0-9() .-]{6,31}$/.test(body.contactNumber.trim())))) errors.contactNumber = 'Enter a valid contact number or leave it blank.';
      if ('displayName' in body && (typeof body.displayName !== 'string' || body.displayName.trim().length > 80)) errors.displayName = 'Display name must be 80 characters or fewer.';
      if ('locale' in body && (typeof body.locale !== 'string' || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(body.locale))) errors.locale = 'Choose a supported language and region code.';
      if ('timeZone' in body && (typeof body.timeZone !== 'string' || !isValidTimeZone(body.timeZone))) errors.timeZone = 'Choose a valid timezone.';
      if (Object.keys(errors).length) return res.status(400).json({ error: { message: 'Check the highlighted fields.', fields: errors } });

      const user = await UserModel.findById(req.user.id);
      if (!user) throw httpError(404, 'Profile not found.');
      if ('name' in body) user.name = body.name.trim();
      if ('contactNumber' in body) user.contactNumber = body.contactNumber.trim();
      user.profileSettings ||= {};
      if ('displayName' in body) user.profileSettings.displayName = body.displayName.trim();
      if ('locale' in body) user.profileSettings.locale = body.locale;
      if ('timeZone' in body) user.profileSettings.timeZone = body.timeZone;
      await user.save();
      const fields = Object.keys(body).map((field) => ({ name: 'name', contactNumber: 'contactNumber', displayName: 'displayName', locale: 'locale', timeZone: 'timeZone' })[field]);
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'user.profile_updated', resourceType: 'user', resourceId: req.user.id, occurredAt: now(), metadata: { result: 'success', changedFields: fields } });
      return res.json({ profile: profileView(user) });
    } catch (error) { return next(error); }
  });

  router.post('/password', passwordLimiter, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (Object.keys(body).some((key) => !['currentPassword', 'newPassword'].includes(key))) throw httpError(400, 'Only the current and new passwords may be submitted.');
      if (typeof body.currentPassword !== 'string' || !body.currentPassword || Buffer.byteLength(body.currentPassword, 'utf8') > 72) throw httpError(400, 'Enter your current password.');
      if (typeof body.newPassword !== 'string' || Buffer.byteLength(body.newPassword, 'utf8') < 12 || Buffer.byteLength(body.newPassword, 'utf8') > 72) throw httpError(400, 'Use a new password that is at least 12 characters and no more than 72 UTF-8 bytes.');
      const user = await UserModel.findById(req.user.id).select('+passwordHash');
      if (!user) throw httpError(404, 'Profile not found.');
      if (!await bcryptImpl.compare(body.currentPassword, user.passwordHash)) throw httpError(400, 'Current password is incorrect.');
      if (await bcryptImpl.compare(body.newPassword, user.passwordHash)) throw httpError(400, 'Choose a new password that differs from your current password.');
      const rounds = Math.min(14, Math.max(10, Number(process.env.BCRYPT_SALT_ROUNDS) || 12));
      user.passwordHash = await bcryptImpl.hash(body.newPassword, rounds);
      await user.save();
      await recordAuditBestEffort({ AuditLogModel, actor: req.user.id, action: 'user.password_changed', resourceType: 'user', resourceId: req.user.id, occurredAt: now(), metadata: { result: 'success' } });
      return res.json({ message: 'Password updated successfully.' });
    } catch (error) { return next(error); }
  });
  return router;
}

export default createProfileRouter();

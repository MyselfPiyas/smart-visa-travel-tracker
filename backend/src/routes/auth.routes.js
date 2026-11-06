import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { getAuthSettings, requireJwtSecret } from '../config/auth.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { createAuthenticate } from '../middleware/authenticate.js';
import { recordAuditBestEffort } from '../services/audit.service.js';

const genericLoginError = 'Email or password is incorrect.';
const dummyHashPromise = bcrypt.hash(randomBytes(32).toString('hex'), 12);

function safeUser(user) {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus, createdAt: user.createdAt };
}

function validateRegistration(body) {
  const errors = {};
  if (Object.keys(body || {}).some((key) => !['name', 'email', 'password', 'website'].includes(key))) errors.form = 'Only supported account fields may be submitted.';
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) errors.name = 'Enter a name between 1 and 120 characters.';
  if (typeof body?.email !== 'string' || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) errors.email = 'Enter a valid email address.';
  if (typeof body?.password !== 'string' || Buffer.byteLength(body.password, 'utf8') < 12 || Buffer.byteLength(body.password, 'utf8') > 72) errors.password = 'Use a password that is at least 12 characters and no more than 72 UTF-8 bytes.';
  return errors;
}

function validateLogin(body) {
  if (Object.keys(body || {}).some((key) => !['email', 'password', 'website'].includes(key))) {
    return { form: 'Enter a valid email address and password.' };
  }
  if (typeof body?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || typeof body?.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 72) {
    return { form: 'Enter a valid email address and password.' };
  }
  return {};
}

function isBotSubmission(body) {
  return body?.website !== undefined && (typeof body.website !== 'string' || body.website.trim().length > 0);
}

function clearCookies(res) {
  const settings = getAuthSettings();
  const { maxAge: _maxAge, ...options } = settings.cookieOptions;
  res.clearCookie(settings.cookieName, options);
  const { httpOnly: _httpOnly, maxAge: _csrfAge, ...csrfOptions } = settings.csrfCookieOptions;
  res.clearCookie('csrf_token', csrfOptions);
}

function rotateCsrfCookie(res) {
  const csrfToken = randomBytes(32).toString('hex');
  res.cookie('csrf_token', csrfToken, getAuthSettings().csrfCookieOptions);
  return csrfToken;
}

export function createAuthRouter({ UserModel = User, AuditLogModel = AuditLog, secretProvider = requireJwtSecret, limiter, now = () => new Date() } = {}) {
  const router = Router();
  const authLimiter = limiter || rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT) || 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Too many authentication attempts. Please try again later.' } } });
  const authenticate = createAuthenticate({ UserModel, getSecret: secretProvider });

  router.get('/csrf', issueCsrfToken);

  router.post('/register', authLimiter, async (req, res, next) => {
    if (isBotSubmission(req.body)) return res.status(400).json({ error: { message: 'Unable to create account. Check your information and try again.' } });
    const errors = validateRegistration(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: { message: 'Check the highlighted fields.', fields: errors } });
    try {
      const email = req.body.email.trim().toLowerCase();
      if (await UserModel.findOne({ email })) return res.status(409).json({ error: { message: 'An account with this email already exists.' } });
      const rounds = Math.min(14, Math.max(10, Number(process.env.BCRYPT_SALT_ROUNDS) || 12));
      const passwordHash = await bcrypt.hash(req.body.password, rounds);
      const user = await UserModel.create({ name: req.body.name.trim(), email, passwordHash, role: 'traveler', accountStatus: 'active' });
      await recordAuditBestEffort({ AuditLogModel, actor: user._id, action: 'user.registered', resourceType: 'user', resourceId: user._id, occurredAt: now(), metadata: { result: 'success' } });
      const settings = getAuthSettings();
      const token = jwt.sign({ sub: String(user._id) }, secretProvider(), { algorithm: 'HS256', expiresIn: settings.jwtExpiresIn, issuer: 'smart-visa-tracker-api', audience: 'smart-visa-tracker-client' });
      res.cookie(settings.cookieName, token, settings.cookieOptions);
      return res.status(201).json({ user: safeUser(user), csrfToken: rotateCsrfCookie(res) });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: { message: 'An account with this email already exists.' } });
      return next(error);
    }
  });

  router.post('/login', authLimiter, async (req, res, next) => {
    if (isBotSubmission(req.body)) return res.status(401).json({ error: { message: genericLoginError } });
    const errors = validateLogin(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: { message: 'Enter your email and password.', fields: errors } });
    try {
      const email = req.body.email.trim().toLowerCase();
      const user = await UserModel.findOne({ email }).select('+passwordHash');
      const hash = user?.passwordHash || await dummyHashPromise;
      const matches = await bcrypt.compare(req.body.password, hash);
      if (!user || !matches || user.accountStatus !== 'active') {
        await recordAuditBestEffort({ AuditLogModel, action: 'user.login_failed', resourceType: 'user', occurredAt: now(), metadata: { result: 'failure', reasonCode: 'invalid_credentials' } });
        return res.status(401).json({ error: { message: genericLoginError } });
      }
      await recordAuditBestEffort({ AuditLogModel, actor: user._id, action: 'user.login', resourceType: 'user', resourceId: user._id, occurredAt: now(), metadata: { result: 'success' } });
      const settings = getAuthSettings();
      const token = jwt.sign({ sub: String(user._id) }, secretProvider(), { algorithm: 'HS256', expiresIn: settings.jwtExpiresIn, issuer: 'smart-visa-tracker-api', audience: 'smart-visa-tracker-client' });
      res.cookie(settings.cookieName, token, settings.cookieOptions);
      return res.json({ user: safeUser(user), csrfToken: rotateCsrfCookie(res) });
    } catch (error) { return next(error); }
  });

  router.post('/logout', async (req, res) => {
    let actor = null;
    const token = req.cookies?.[getAuthSettings().cookieName];
    if (token) {
      try { actor = jwt.verify(token, secretProvider(), { algorithms: ['HS256'], issuer: 'smart-visa-tracker-api', audience: 'smart-visa-tracker-client' }).sub || null; }
      catch { /* Logout must still clear cookies for expired or invalid sessions. */ }
    }
    clearCookies(res);
    if (actor) {
      await recordAuditBestEffort({ AuditLogModel, actor, action: 'user.logout', resourceType: 'user', resourceId: actor, occurredAt: now(), metadata: { result: 'success' } });
    }
    return res.status(204).end();
  });
  router.get('/me', authenticate, async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.user.id);
      if (!user) return res.status(401).json({ error: { message: 'Please sign in to continue.' } });
      return res.json({ user: safeUser(user) });
    } catch (error) { return next(error); }
  });

  return router;
}

export default createAuthRouter();

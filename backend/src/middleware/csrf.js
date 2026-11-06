import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getAuthSettings } from '../config/auth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(_req, res) {
  const token = randomBytes(32).toString('hex');
  res.cookie('csrf_token', token, getAuthSettings().csrfCookieOptions);
  return res.json({ csrfToken: token });
}

export default function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length) {
    return res.status(403).json({ error: { message: 'Request security check failed. Refresh the page and try again.' } });
  }
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer)) {
    return res.status(403).json({ error: { message: 'Request security check failed. Refresh the page and try again.' } });
  }
  return next();
}

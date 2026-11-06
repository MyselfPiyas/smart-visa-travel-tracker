import { getAuthSettings, requireJwtSecret } from './auth.js';

export function validateEnvironment(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const rawOrigins = env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173';
  const origins = rawOrigins.split(',').map((value) => value.trim()).filter(Boolean);
  if (!origins.length) throw new Error('FRONTEND_ORIGIN must contain at least one allowed origin.');
  for (const origin of origins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('FRONTEND_ORIGIN must contain valid origins without paths.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('FRONTEND_ORIGIN must contain valid origins without paths.');
    if (production && parsed.protocol !== 'https:') throw new Error('Production FRONTEND_ORIGIN values must use HTTPS.');
  }
  const auth = getAuthSettings(env);
  if (production) {
    requireJwtSecret(env);
    if (!/^mongodb(?:\+srv)?:\/\//i.test(env.MONGODB_URI || '')) throw new Error('MONGODB_URI must be configured for production.');
    if (!origins.every((origin) => origin.startsWith('https://'))) throw new Error('All production browser origins must use HTTPS.');
    if ((env.DOCUMENT_STORAGE_PROVIDER || 'local') === 'local' && !/^[a-f\d]{64}$/i.test(env.DOCUMENT_ENCRYPTION_KEY || '')) throw new Error('DOCUMENT_ENCRYPTION_KEY must be a 32-byte hexadecimal key when local file storage is enabled.');
  }
  const rateLimit = env.AUTH_RATE_LIMIT === undefined ? 10 : Number(env.AUTH_RATE_LIMIT);
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 1000) throw new Error('AUTH_RATE_LIMIT must be an integer from 1 to 1000.');
  return { production, origins, jwtExpiresInSeconds: auth.jwtExpiresInSeconds };
}

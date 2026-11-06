export function getAuthSettings(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const sameSite = (env.AUTH_COOKIE_SAME_SITE || (production ? 'none' : 'strict')).toLowerCase();
  if (!['strict', 'lax', 'none'].includes(sameSite)) throw new Error('AUTH_COOKIE_SAME_SITE must be strict, lax, or none.');
  const secure = production || env.AUTH_COOKIE_SECURE === 'true';
  if (sameSite === 'none' && !secure) throw new Error('SameSite=None cookies require Secure=true.');
  const expiresIn = env.JWT_EXPIRES_IN || '30m';
  const duration = /^(\d+)(s|m|h|d)$/.exec(expiresIn);
  if (!duration) throw new Error('JWT_EXPIRES_IN must use seconds, minutes, hours, or days (for example 30m).');
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400 }[duration[2]];
  const expiresInSeconds = Number(duration[1]) * unitSeconds;
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 86400) throw new Error('JWT_EXPIRES_IN must be between 60 seconds and 24 hours.');
  return {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: expiresIn,
    jwtExpiresInSeconds: expiresInSeconds,
    cookieName: production ? '__Host-access_token' : 'access_token',
    cookieOptions: { httpOnly: true, secure, sameSite, path: '/', maxAge: expiresInSeconds * 1000 },
    csrfCookieOptions: { httpOnly: true, secure, sameSite, path: '/', maxAge: 60 * 60 * 1000 },
  };
}

export function requireJwtSecret(env = process.env) {
  const secret = getAuthSettings(env).jwtSecret;
  if (!secret || secret.length < 32 || secret.startsWith('replace-with-')) {
    throw new Error('JWT_SECRET must be set to at least 32 characters of random secret material.');
  }
  return secret;
}

import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { getAuthSettings, requireJwtSecret } from '../config/auth.js';

export function createAuthenticate({ UserModel = User, secret, getSecret = requireJwtSecret } = {}) {
  return async function authenticate(req, res, next) {
    const token = req.cookies?.[getAuthSettings().cookieName];
    if (!token) return res.status(401).json({ error: { message: 'Please sign in to continue.' } });
    try {
      const claims = jwt.verify(token, secret || getSecret(), { algorithms: ['HS256'], issuer: 'smart-visa-tracker-api', audience: 'smart-visa-tracker-client' });
      const user = await UserModel.findById(claims.sub);
      if (!user || user.accountStatus !== 'active') return res.status(401).json({ error: { message: 'Please sign in to continue.' } });
      req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role };
      return next();
    } catch (error) {
      if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError' && error.name !== 'NotBeforeError') return next(error);
      return res.status(401).json({ error: { message: 'Please sign in to continue.' } });
    }
  };
}

export default createAuthenticate();

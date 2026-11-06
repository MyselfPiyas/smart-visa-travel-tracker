import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import csrfProtection from './middleware/csrf.js';
import healthRouter from './routes/health.routes.js';
import authRouter from './routes/auth.routes.js';
import { adminRouter, travelerRouter } from './routes/protected.routes.js';
import errorHandler from './middleware/error-handler.js';
import requestLogger from './middleware/request-logger.js';

const app = express();

app.disable('x-powered-by');
const proxyHops = process.env.TRUST_PROXY_HOPS === undefined ? 0 : Number(process.env.TRUST_PROXY_HOPS);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
app.set('trust proxy', proxyHops);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean);
for (const origin of allowedOrigins) {
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error('FRONTEND_ORIGIN must contain valid origins without paths.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('FRONTEND_ORIGIN must contain valid origins without paths.');
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') throw new Error('Production FRONTEND_ORIGIN values must use HTTPS.');
}

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    const error = new Error('Origin is not allowed by CORS.');
    error.status = 403;
    return callback(error);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(requestLogger);
app.use('/api', csrfProtection);

app.get('/', (_req, res) => {
  res.json({ name: 'Smart Visa & Travel Document Tracker API', status: 'running' });
});
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/traveler', travelerRouter);
app.use('/api/admin', adminRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { message: 'Route not found' } });
});
app.use(errorHandler);

export default app;

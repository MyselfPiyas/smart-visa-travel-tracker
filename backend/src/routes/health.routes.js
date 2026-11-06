import { Router } from 'express';
import { getDatabaseStatus } from '../config/database.js';

const router = Router();

export function healthHandler(_req, res) {
  const database = process.env.MONGODB_URI ? getDatabaseStatus() : 'not_configured';
  const healthy = database === 'connected' || database === 'not_configured';
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'smart-visa-tracker-api',
    database,
  });
}

// Liveness must stay healthy during a temporary database outage so the host
// keeps the API process running and its database retry manager can recover.
export function livenessHandler(_req, res) {
  return res.status(200).json({ status: 'ok', service: 'smart-visa-tracker-api' });
}

router.get('/', healthHandler);
router.get('/ready', healthHandler);
router.get('/live', livenessHandler);

export default router;

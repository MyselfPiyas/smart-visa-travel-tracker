import { Router } from 'express';
import defaultExpiryTrackingService from '../services/expiry-tracking.service.js';

function badRequest(message) { const error = new Error(message); error.status = 400; return error; }

export function createExpiryRouter({ trackingService = defaultExpiryTrackingService } = {}) {
  const router = Router();
  router.get('/summary', async (req, res, next) => {
    try { return res.json(await trackingService.getSummary(req.user.id)); }
    catch (error) { return next(error); }
  });
  router.get('/upcoming', async (req, res, next) => {
    try {
      const raw = req.query.withinDays;
      const withinDays = raw === undefined ? undefined : Number(raw);
      if (withinDays !== undefined && (!Number.isInteger(withinDays) || withinDays < 1 || withinDays > 365)) throw badRequest('withinDays must be a whole number from 1 to 365.');
      return res.json({ items: await trackingService.getUpcoming(req.user.id, withinDays) });
    } catch (error) { return next(error); }
  });
  router.get('/expired', async (req, res, next) => {
    try { return res.json({ items: await trackingService.getExpired(req.user.id) }); }
    catch (error) { return next(error); }
  });
  router.get('/potential-overstay-warnings', async (req, res, next) => {
    try { return res.json({ informationalOnly: true, items: await trackingService.getPotentialOverstayWarnings(req.user.id) }); }
    catch (error) { return next(error); }
  });
  return router;
}

export default createExpiryRouter();

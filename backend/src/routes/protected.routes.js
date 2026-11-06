import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import getDashboard from '../services/dashboard.service.js';
import { createDocumentRouter } from './documents.routes.js';
import { createExpiryRouter } from './expiry.routes.js';
import { createAdminNotificationRouter, createTravelerNotificationRouter } from './notifications.routes.js';
import { createTravelHistoryRouter } from './travel-history.routes.js';
import { createAdminDestinationRouter, createTravelerDestinationRouter } from './destination-requirements.routes.js';
import { createAdminDashboardRouter, createAdminSupportRouter, createAdminUserRouter } from './admin.routes.js';
import { createProfileRouter } from './profile.routes.js';
import { createTravelerSupportRouter } from './support.routes.js';

export function createTravelerRouter({ authenticateMiddleware = authenticate, getDashboardData = getDashboard, documentRouter = createDocumentRouter(), expiryRouter = createExpiryRouter(), notificationRouter = createTravelerNotificationRouter(), travelHistoryRouter = createTravelHistoryRouter(), destinationRouter = createTravelerDestinationRouter(), profileRouter = createProfileRouter(), supportRouter = createTravelerSupportRouter() } = {}) {
  const router = Router();
  router.use(authenticateMiddleware, authorize('traveler'));
  router.get('/', (req, res) => res.json({ message: 'Traveler access verified.', user: req.user }));
  router.get('/dashboard', async (req, res, next) => {
    try { return res.json(await getDashboardData(req.user)); }
    catch (error) { return next(error); }
  });
  // Documents inherit the authenticated traveler-only policy above.
  router.use('/documents/expiry', expiryRouter);
  router.use('/notifications', notificationRouter);
  router.use('/travel-history', travelHistoryRouter);
  router.use('/destinations', destinationRouter);
  router.use('/profile', profileRouter);
  router.use('/support', supportRouter);
  router.use('/documents', documentRouter);
  return router;
}

export function createAdminRouter({ authenticateMiddleware = authenticate, notificationRouter = createAdminNotificationRouter(), destinationRouter = createAdminDestinationRouter(), dashboardRouter = createAdminDashboardRouter(), userRouter = createAdminUserRouter(), supportRouter = createAdminSupportRouter() } = {}) {
  const router = Router();
  router.use(authenticateMiddleware, authorize('admin'));
  router.get('/', (req, res) => res.json({ message: 'Administrator access verified.', user: req.user }));
  router.use('/notifications', notificationRouter);
  router.use('/destinations', destinationRouter);
  router.use('/dashboard', dashboardRouter);
  router.use('/users', userRouter);
  router.use('/support', supportRouter);
  return router;
}

export const travelerRouter = createTravelerRouter();
export const adminRouter = createAdminRouter();

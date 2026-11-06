import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAdminRouter } from '../src/routes/protected.routes.js';
import errorHandler from '../src/middleware/error-handler.js';

function makeApp({ role = 'admin' } = {}) {
  const router = createAdminRouter({
    authenticateMiddleware: (req, _res, next) => { if (role) req.user = { id: '507f1f77bcf86cd799439011', role }; next(); },
    notificationRouter: express.Router(), destinationRouter: express.Router(),
  });
  const app = express(); app.use(express.json()); app.use('/admin', router); app.use(errorHandler); return app;
}

test('traveler cannot access administrator APIs; an administrator can', async () => {
  let response = await request(makeApp({ role: 'traveler' })).get('/admin');
  assert.equal(response.status, 403);
  response = await request(makeApp({ role: 'admin' })).get('/admin');
  assert.equal(response.status, 200);
});

test('audit activity can only be read through the server-side administrator route group', async () => {
  const { createAdminDashboardRouter } = await import('../src/routes/admin.routes.js');
  const auditRows = [{ _id: 'audit-1', actor: null, action: 'user.login_failed', resourceType: 'user', resourceId: null, occurredAt: new Date(), metadata: { changedFields: [] } }];
  const AuditLogModel = { find: () => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => auditRows }) };
  const makeProtected = (role) => {
    const router = createAdminRouter({ authenticateMiddleware: (req, _res, next) => { req.user = { id: 'admin-or-traveler', role }; next(); }, dashboardRouter: createAdminDashboardRouter({ AuditLogModel }), notificationRouter: express.Router(), destinationRouter: express.Router(), userRouter: express.Router(), supportRouter: express.Router() });
    const app = express(); app.use('/api/admin', router); app.use(errorHandler); return app;
  };
  await request(makeProtected('traveler')).get('/api/admin/dashboard/activity').expect(403);
  const result = await request(makeProtected('admin')).get('/api/admin/dashboard/activity').expect(200);
  assert.equal(result.body.items[0].action, 'user.login_failed');
});

test('status updates reject invalid values and audit a successful suspension', async () => {
  const saved = [];
  const traveler = { _id: '507f1f77bcf86cd799439012', name: 'Sam Traveler', email: 'sam@example.com', role: 'traveler', accountStatus: 'active', profileSettings: {}, createdAt: new Date(), async save() {} };
  const UserModel = { findOne: () => traveler };
  const AuditLogModel = { create: async (entry) => { saved.push(entry); } };
  // Mount the injectable user router directly to isolate the status workflow.
  const { createAdminUserRouter } = await import('../src/routes/admin.routes.js');
  const direct = express(); direct.use(express.json()); direct.use((req,_res,next)=>{req.user={id:'507f1f77bcf86cd799439011',role:'admin'};next();}); direct.use('/users', createAdminUserRouter({UserModel, AuditLogModel})); direct.use(errorHandler);
  let response = await request(direct).patch('/users/507f1f77bcf86cd799439012/status').send({ accountStatus: 'admin' });
  assert.equal(response.status, 400);
  response = await request(direct).patch('/users/507f1f77bcf86cd799439012/status').send({ accountStatus: 'suspended' });
  assert.equal(response.status, 200); assert.equal(response.body.user.accountStatus, 'suspended');
  assert.equal(saved.length, 1); assert.equal(saved[0].action, 'user.suspended'); assert.deepEqual(saved[0].metadata.changedFields, ['accountStatus']);
  assert.equal('passwordHash' in response.body.user, false);
  response = await request(direct).patch('/users/507f1f77bcf86cd799439012/status').send({ accountStatus: 'active' });
  assert.equal(response.status, 200); assert.equal(saved[1].action, 'user.reactivated');
});

test('administrator list validates filters and paginates without returning password hashes', async () => {
  const user = { _id: '507f1f77bcf86cd799439012', name: 'Sam', email: 'sam@example.com', role: 'traveler', accountStatus: 'active', profileSettings: {}, createdAt: new Date(), updatedAt: new Date() };
  const chain = { sort() { return this; }, skip() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => [user] };
  let requestedFilter;
  const UserModel = { find: (filter) => { requestedFilter = filter; return chain; }, countDocuments: async () => 1 };
  const { createAdminUserRouter } = await import('../src/routes/admin.routes.js');
  const app = express(); app.use((req,_res,next)=>{req.user={id:'507f1f77bcf86cd799439011',role:'admin'};next();}); app.use('/users',createAdminUserRouter({UserModel})); app.use(errorHandler);
  const response = await request(app).get('/users?q=Sam&status=active&createdFrom=2025-01-01&createdTo=2025-12-31&page=1&limit=1');
  assert.equal(response.status, 200); assert.equal(response.body.pagination.total, 1); assert.equal(response.body.users[0].email, 'sam@example.com'); assert.equal('passwordHash' in response.body.users[0], false);
  assert.equal(requestedFilter.role, 'traveler'); assert.equal(requestedFilter.accountStatus, 'active'); assert.equal(requestedFilter.$or[0].name.$regex, 'Sam'); assert.equal(requestedFilter.createdAt.$gte.toISOString(), '2025-01-01T00:00:00.000Z');
  assert.equal((await request(app).get('/users?status=superadmin')).status, 400);
  assert.equal((await request(app).get('/users?createdFrom=2025-02-31')).status, 400);
});

test('summary aggregates real counts and computes delivery success from sent and failed only', async () => {
  const { createAdminDashboardRouter } = await import('../src/routes/admin.routes.js');
  const emptyAudit = { find: () => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => [] }) };
  const app = express(); app.use('/dashboard', createAdminDashboardRouter({ UserModel: { aggregate: async () => [{ total: 10, active: 8, suspended: 2 }] }, DocumentModel: { aggregate: async () => [{ total: 20, expiringSoon: 3, expired: 4 }] }, TravelHistoryModel: { countDocuments: async () => 7 }, NotificationModel: { aggregate: async () => [{ total: 11, sent: 7, failed: 2, pending: 2 }] }, RequirementModel: { countDocuments: async () => 6 }, AuditLogModel: emptyAudit })); app.use(errorHandler);
  const response = await request(app).get('/dashboard/summary');
  assert.equal(response.status, 200); assert.deepEqual(response.body.users, { total: 10, active: 8, suspended: 2 }); assert.equal(response.body.notifications.successRate, 77.78); assert.equal(response.body.notifications.pending, 2); assert.equal(response.body.destinationRequirements.active, 6);
});

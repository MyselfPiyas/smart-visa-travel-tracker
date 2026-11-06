import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import errorHandler from '../src/middleware/error-handler.js';
import { createProfileRouter } from '../src/routes/profile.routes.js';
import { createTravelerSupportRouter } from '../src/routes/support.routes.js';
import { createAdminSupportRouter } from '../src/routes/admin.routes.js';
import { createAdminRouter } from '../src/routes/protected.routes.js';

const travelerId = '507f1f77bcf86cd799439011';
const adminId = '507f1f77bcf86cd799439012';
const queryId = '507f1f77bcf86cd799439013';
function query(value) { const chain = { select() { return chain; }, populate() { return chain; }, lean() { return Promise.resolve(value); }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } }; return chain; }
function testApp(user, router, prefix) { const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = user; next(); }); app.use(prefix, router); app.use(errorHandler); return app; }

test('profile retrieval and update are scoped to the session and never expose password hashes', async () => {
  const user = { _id: travelerId, name: 'Traveler', email: 'traveler@example.com', contactNumber: '', role: 'traveler', accountStatus: 'active', profileSettings: { displayName: '', locale: 'en', timeZone: 'UTC' }, createdAt: new Date(), updatedAt: new Date(), async save() { this.updatedAt = new Date(); } };
  const UserModel = { findById: () => query(user) };
  const audit = [];
  const app = testApp({ id: travelerId, role: 'traveler' }, createProfileRouter({ UserModel, AuditLogModel: { create: async (event) => audit.push(event) }, passwordLimiter: (_req, _res, next) => next() }), '/profile');
  const get = await request(app).get('/profile').expect(200);
  assert.equal(get.body.profile.email, 'traveler@example.com'); assert.equal('passwordHash' in get.body.profile, false);
  const update = await request(app).patch('/profile').send({ name: 'New Name', contactNumber: '+91 98765 43210', timeZone: 'Asia/Kolkata' }).expect(200);
  assert.equal(user.name, 'New Name'); assert.equal(user.contactNumber, '+91 98765 43210'); assert.equal(user.profileSettings.timeZone, 'Asia/Kolkata'); assert.equal(update.body.profile.profileSettings.timeZone, 'Asia/Kolkata');
  assert.equal(audit[0].action, 'user.profile_updated');
  assert.equal(JSON.stringify(audit).includes('New Name'), false);
  await request(app).patch('/profile').send({ email: 'other@example.com' }).expect(400);
  await request(app).patch('/profile').send({ timeZone: 'Not/AZone' }).expect(400);
});

test('password update verifies current password, hashes the new password, and validates strength', async () => {
  const originalHash = await bcrypt.hash('previous-strong-password', 4);
  const user = { _id: travelerId, passwordHash: originalHash, async save() {} };
  const UserModel = { findById: () => query(user) };
  const audit = [];
  const app = testApp({ id: travelerId, role: 'traveler' }, createProfileRouter({ UserModel, AuditLogModel: { create: async (event) => audit.push(event) }, passwordLimiter: (_req, _res, next) => next() }), '/profile');
  await request(app).post('/profile/password').send({ currentPassword: 'wrong-password', newPassword: 'a-different-strong-password' }).expect(400);
  await request(app).post('/profile/password').send({ currentPassword: 'previous-strong-password', newPassword: 'short' }).expect(400);
  await request(app).post('/profile/password').send({ currentPassword: 'previous-strong-password', newPassword: 'a-different-strong-password' }).expect(200);
  assert.notEqual(user.passwordHash, originalHash); assert.equal(await bcrypt.compare('a-different-strong-password', user.passwordHash), true);
  assert.equal(audit.some((event) => event.action === 'user.password_changed'), true);
  assert.equal(JSON.stringify(audit).includes('strong-password'), false);
});

test('support creation and listing are scoped to the signed-in user; cross-user details return not found', async () => {
  const rows = [];
  const SupportModel = {
    async create(input) { const row = { ...input, _id: queryId, createdAt: new Date(), updatedAt: new Date(), async save() {} }; rows.push(row); return row; },
    find(filter) { return { sort() { return this; }, skip() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => rows.filter((row) => String(row.user) === String(filter.user)) }; },
    countDocuments: async (filter) => rows.filter((row) => String(row.user) === String(filter.user)).length,
    findOne(filter) { return query(rows.find((row) => String(row._id) === String(filter._id) && String(row.user) === String(filter.user)) || null); },
  };
  const router = createTravelerSupportRouter({ SupportModel });
  const app = testApp({ id: travelerId, role: 'traveler' }, router, '/support');
  const created = await request(app).post('/support').send({ subject: 'Travel question', message: 'Please help me understand this checklist.' }).expect(201);
  assert.equal(created.body.query.status, 'open'); assert.equal(created.body.query.messages[0].authorType, 'traveler');
  assert.equal((await request(app).get('/support').expect(200)).body.items.length, 1);
  await request(app).get(`/support/${queryId}`).expect(200);
  const other = testApp({ id: adminId, role: 'traveler' }, router, '/support');
  await request(other).get(`/support/${queryId}`).expect(404);
  await request(app).post('/support').send({ subject: '<script>bad</script>', message: 'Please help me' }).expect(400);
});

test('administrator can reply and update support status; travelers cannot access admin support routes', async () => {
  const row = { _id: queryId, user: { _id: travelerId, name: 'Traveler', email: 'traveler@example.com' }, subject: 'Travel question', message: 'Please help me.', status: 'open', messages: [], createdAt: new Date(), updatedAt: new Date(), async save() {} };
  const SupportModel = { findById: () => query(row), find: () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, select() { return this; }, populate() { return this; }, lean: async () => [row] }), countDocuments: async () => 1 };
  const audit = [];
  const supportRouter = createAdminSupportRouter({ SupportModel, AuditLogModel: { create: async (record) => audit.push(record) } });
  const router = createAdminRouter({ authenticateMiddleware: (req, _res, next) => { req.user = { id: adminId, role: 'admin' }; next(); }, notificationRouter: express.Router(), destinationRouter: express.Router(), dashboardRouter: express.Router(), userRouter: express.Router(), supportRouter });
  const adminApp = express(); adminApp.use(express.json()); adminApp.use('/admin', router); adminApp.use(errorHandler);
  await request(adminApp).post(`/admin/support/${queryId}/replies`).send({ message: 'Please review the official checklist.', status: 'waiting_for_user' }).expect(200);
  assert.equal(row.messages[0].authorType, 'admin'); assert.equal(audit[0].action, 'support.admin_replied');
  await request(adminApp).patch(`/admin/support/${queryId}/status`).send({ status: 'resolved' }).expect(200);
  assert.equal(row.status, 'resolved'); assert.equal(audit[1].metadata.changedFields[0], 'supportStatus');
  const travelerRouter = createAdminRouter({ authenticateMiddleware: (req, _res, next) => { req.user = { id: travelerId, role: 'traveler' }; next(); }, notificationRouter: express.Router(), destinationRouter: express.Router(), dashboardRouter: express.Router(), userRouter: express.Router(), supportRouter });
  const travelerApp = express(); travelerApp.use('/admin', travelerRouter);
  await request(travelerApp).get('/admin/support').expect(403);
});

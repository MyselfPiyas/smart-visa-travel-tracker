import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import errorHandler from '../src/middleware/error-handler.js';
import { createAdminNotificationRouter, createTravelerNotificationRouter } from '../src/routes/notifications.routes.js';

const owner = '507f1f77bcf86cd799439011';
const other = '507f1f77bcf86cd799439012';
const rows = [
  { _id: '507f1f77bcf86cd799439021', owner, type: 'expiry_30_day', deliveryStatus: 'failed', scheduledAt: new Date('2027-01-01'), attemptCount: 3, safeError: { code: 'SMTP_CONNECTION_FAILED', category: 'network' }, relatedDocument: { displayName: 'Passport', documentType: 'passport', expiryDate: new Date('2027-02-01') }, createdAt: new Date('2027-01-01'), idempotencyKey: 'secret-key' },
  { _id: '507f1f77bcf86cd799439022', owner: other, type: 'system', deliveryStatus: 'sent', scheduledAt: new Date(), attemptCount: 1, createdAt: new Date() },
];
function matches(row, filter) { return Object.entries(filter).every(([key, value]) => value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[key]) : String(row[key]) === String(value)); }
function query(items, filter, single = false) {
  let offset = 0; let limit = Infinity;
  const q = { sort() { return q; }, skip(value) { offset = value; return q; }, limit(value) { limit = value; return q; }, select() { return q; }, populate() { return q; }, lean: async () => { const result = items.filter((row) => matches(row, filter)).slice(offset, offset + limit); return single ? result[0] || null : result; } };
  return q;
}
const NotificationModel = {
  find: (filter) => query(rows, filter), findOne: (filter) => query(rows, filter, true),
  countDocuments: async (filter) => rows.filter((row) => matches(row, filter)).length,
  findOneAndUpdate: (filter, update) => { const row = rows.find((item) => matches(item, filter)); if (row) Object.assign(row, update.$set); return query(row ? [row] : [], {}, true); },
};
let storedPreferences = { reminderPreferences: {}, profileSettings: { timeZone: 'UTC' } };
const UserModel = { findById: () => ({ select() { return this; }, lean: async () => storedPreferences }), findByIdAndUpdate: (_id, update) => { for (const [key, value] of Object.entries(update.$set)) { const [section, property] = key.split('.'); storedPreferences[section] ||= {}; storedPreferences[section][property] = value; } return query([storedPreferences], {}, true); } };

function makeApp(router, path, role = 'traveler') {
  const app = express(); app.use(express.json());
  app.use(path, (req, _res, next) => { req.user = { id: owner, role }; next(); }, router); app.use(errorHandler); return app;
}

test('traveler notification history is owner-scoped and omits internal delivery details', async () => {
  const app = makeApp(createTravelerNotificationRouter({ NotificationModel, UserModel, AuditLogModel: { create: async () => {} } }), '/notifications');
  const response = await request(app).get('/notifications').expect(200);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].document.displayName, 'Passport');
  assert.equal(response.body.items[0].deliveryIssue.category, 'network');
  assert.equal(JSON.stringify(response.body).includes('secret-key'), false);
  assert.equal(JSON.stringify(response.body).includes('traveler@example'), false);
});

test('traveler cannot view another owner notification and can mark their own read', async () => {
  const app = makeApp(createTravelerNotificationRouter({ NotificationModel, UserModel, AuditLogModel: { create: async () => {} } }), '/notifications');
  await request(app).get(`/notifications/${rows[1]._id}`).expect(404);
  const result = await request(app).patch(`/notifications/${rows[0]._id}/read`).expect(200);
  assert.ok(result.body.notification.readAt);
});

test('reminder preferences validate timezone and save only allowed fields', async () => {
  const app = makeApp(createTravelerNotificationRouter({ NotificationModel, UserModel, AuditLogModel: { create: async () => {} } }), '/notifications');
  await request(app).put('/notifications/preferences').send({ timeZone: 'not/a-zone' }).expect(400);
  const response = await request(app).put('/notifications/preferences').send({ expiryIntervals: [90, 30], timeZone: 'Asia/Kolkata' }).expect(200);
  assert.deepEqual(response.body.preferences.expiryIntervals, [90, 30]);
  assert.equal(response.body.preferences.timeZone, 'Asia/Kolkata');
});

test('admin notification monitoring provides safe logs without owner or recipient data', async () => {
  const app = makeApp(createAdminNotificationRouter({ NotificationModel }), '/admin/notifications', 'admin');
  const response = await request(app).get('/admin/notifications?status=failed').expect(200);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].safeError.code, 'SMTP_CONNECTION_FAILED');
  assert.equal(JSON.stringify(response.body).includes(owner), false);
  assert.equal(JSON.stringify(response.body).includes('idempotencyKey'), false);
});

test('admin notification statistics include attempts and retry counts without private fields', async () => {
  const statsModel = { aggregate: async () => [{ total: 2, pending: 0, processing: 0, sent: 1, failed: 1, cancelled: 0, totalAttempts: 4, retryAttempts: 2 }] };
  const app = makeApp(createAdminNotificationRouter({ NotificationModel: statsModel }), '/admin/notifications', 'admin');
  const response = await request(app).get('/admin/notifications/stats').expect(200);
  assert.equal(response.body.total, 2); assert.equal(response.body.totals.totalAttempts, 4); assert.equal(response.body.totals.retryAttempts, 2);
  assert.equal(JSON.stringify(response.body).includes('email'), false);
});

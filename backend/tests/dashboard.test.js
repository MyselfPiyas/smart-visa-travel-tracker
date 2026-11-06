import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import errorHandler from '../src/middleware/error-handler.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';
import { createTravelerRouter } from '../src/routes/protected.routes.js';
import { createDashboardService } from '../src/services/dashboard.service.js';
import { createExpiryTrackingService } from '../src/services/expiry-tracking.service.js';
import { createExpiryRouter } from '../src/routes/expiry.routes.js';

const travelerId = '507f1f77bcf86cd799439011';
const otherId = '507f1f77bcf86cd799439012';
const secret = 'dashboard-tests-only-random-secret-material';
const fixedNow = new Date('2026-03-15T12:00:00.000Z');
const addDays = (count) => new Date(Date.UTC(2026, 2, 15 + count, 0));

function matches(row, filter) {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$or') { if (!expected.some((branch) => matches(row, branch))) return false; continue; }
    const actual = row[key];
    if (key === 'owner' || key === '_id') { if (String(actual) !== String(expected)) return false; continue; }
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
      if ('$ne' in expected && actual === expected.$ne) return false;
      if ('$gte' in expected && !(actual != null && actual >= expected.$gte)) return false;
      if ('$gt' in expected && !(actual != null && actual > expected.$gt)) return false;
      if ('$lt' in expected && !(actual != null && actual < expected.$lt)) return false;
      if ('$lte' in expected && !(actual != null && actual <= expected.$lte)) return false;
      if ('$exists' in expected && Boolean(actual !== undefined) !== expected.$exists) return false;
      if ('$in' in expected && !expected.$in.includes(actual)) return false;
      continue;
    }
    if (expected === null) { if (actual != null) return false; }
    else if (actual !== expected) return false;
  }
  return true;
}

function query(rows, filter, seen) {
  seen.push(filter);
  let sortSpec = null; let max = Infinity;
  const q = {
    sort(spec) { sortSpec = spec; return q; }, limit(value) { max = value; return q; }, select() { return q; },
    async lean() {
      let result = rows.filter((row) => matches(row, filter));
      if (sortSpec) {
        const [[key, direction]] = Object.entries(sortSpec);
        result = result.toSorted((a, b) => ((a[key] ?? 0) > (b[key] ?? 0) ? 1 : (a[key] ?? 0) < (b[key] ?? 0) ? -1 : 0) * direction);
      }
      return result.slice(0, max);
    },
  };
  return q;
}

function createFixtureModels({ fail = false, empty = false } = {}) {
  const docs = empty ? [] : [
    { owner: travelerId, status: 'valid', displayName: 'Old passport', documentType: 'passport', expiryDate: addDays(-2) },
    { owner: travelerId, status: 'valid', displayName: 'Entry visa', documentType: 'visa', validFrom: addDays(-30), expiryDate: addDays(7), visaEntryType: 'single_entry' },
    { owner: travelerId, status: 'valid', displayName: 'Residence card', documentType: 'residence_permit', expiryDate: addDays(45) },
    { owner: travelerId, status: 'valid', displayName: 'Insurance', documentType: 'travel_insurance', expiryDate: null },
    { owner: travelerId, status: 'archived', displayName: 'Archived file', documentType: 'other', expiryDate: addDays(2) },
    { owner: otherId, status: 'valid', displayName: 'Other traveler file', documentType: 'passport', expiryDate: addDays(7) },
  ];
  const notifications = empty ? [] : [
    { owner: travelerId, type: 'expiry_reminder', deliveryStatus: 'pending', scheduledAt: addDays(1), createdAt: fixedNow },
    { owner: travelerId, type: 'system', deliveryStatus: 'sent', scheduledAt: addDays(-1), createdAt: addDays(-1), sentAt: addDays(-1) },
    { owner: otherId, type: 'support_update', deliveryStatus: 'sent', createdAt: addDays(-1) },
  ];
  const histories = empty ? [] : [
    { owner: travelerId, destinationCountry: 'JP', purpose: 'tourism', departureDate: addDays(-25), returnDate: addDays(-18), actualExitDate: null },
    { owner: otherId, destinationCountry: 'CA', purpose: 'study', departureDate: addDays(-10) },
  ];
  const seenFilters = { notifications: [], histories: [], documents: [] };
  const ensure = () => { if (fail) throw new Error('database connection string must not leak'); };
  const TravelDocumentModel = {
    countDocuments(filter) { ensure(); seenFilters.documents.push(filter); return Promise.resolve(docs.filter((row) => matches(row, filter)).length); },
    find(filter) { ensure(); return query(docs, filter, seenFilters.documents); },
    findOne(filter) { ensure(); return query(docs.filter((row) => matches(row, filter)).slice(0, 1), {}, seenFilters.documents); },
  };
  const NotificationModel = { find(filter) { ensure(); return query(notifications, filter, seenFilters.notifications); } };
  const TravelHistoryModel = { find(filter) { ensure(); return query(histories, filter, seenFilters.histories); }, countDocuments(filter) { ensure(); return Promise.resolve(histories.filter((row) => matches(row, filter)).length); } };
  return { TravelDocumentModel, NotificationModel, TravelHistoryModel, seenFilters };
}

function makeDashboardApp(models) {
  const user = { _id: new mongoose.Types.ObjectId(travelerId), name: 'Asha Traveler', email: 'asha@example.test', role: 'traveler', accountStatus: 'active' };
  const UserModel = { async findById(id) { return String(id) === travelerId ? user : null; } };
  const authenticate = createAuthenticate({ UserModel, secret });
  const app = express(); app.use(cookieParser());
  const trackingService = createExpiryTrackingService({ TravelDocumentModel: models.TravelDocumentModel, DocumentModel: models.TravelDocumentModel, TravelHistoryModel: models.TravelHistoryModel, now: () => fixedNow });
  app.use('/api/traveler', createTravelerRouter({ authenticateMiddleware: authenticate, getDashboardData: createDashboardService({ ...models, now: () => fixedNow }), expiryRouter: createExpiryRouter({ trackingService }) }));
  app.use(errorHandler);
  return app;
}

function sessionCookie(userId = travelerId) {
  const token = jwt.sign({ sub: userId }, secret, { algorithm: 'HS256', expiresIn: '10m', issuer: 'smart-visa-tracker-api', audience: 'smart-visa-tracker-client' });
  return `access_token=${token}`;
}

test('dashboard API requires an authenticated traveler session', async () => {
  await request(makeDashboardApp(createFixtureModels())).get('/api/traveler/dashboard').expect(401);
});

test('dashboard returns centralized expiry counts and only the session owner records', async () => {
  const models = createFixtureModels();
  const response = await request(makeDashboardApp(models)).get('/api/traveler/dashboard?userId=507f1f77bcf86cd799439012').set('Cookie', sessionCookie()).expect(200);
  assert.deepEqual(response.body.counts, { total: 4, valid: 0, expiringSoon: 2, expired: 1, pendingInformation: 1, notYetValid: 0 });
  assert.equal(response.body.thresholds[0], 90);
  assert.equal(response.body.upcomingExpiries.length, 2);
  assert.equal(response.body.upcomingExpiries[0].status, 'expiring_soon');
  assert.equal(response.body.upcomingExpiries[0].remainingDays, 7);
  assert.equal(response.body.nextUpcomingExpiry.displayName, 'Entry visa');
  assert.equal(response.body.potentialOverstayWarnings.length, 1);
  assert.equal(response.body.potentialOverstayWarnings[0].informationalOnly, true);
  assert.equal(response.body.upcomingReminders.length, 1);
  assert.equal(response.body.recentNotifications.length, 2);
  assert.equal(response.body.recentTravelHistory.length, 1);
  assert.equal(response.body.totalTravelRecords, 1);
  assert.equal(response.body.upcomingTrips.length, 0);
  assert.deepEqual(response.body.recentlyVisitedCountries, ['JP']);
  assert.ok(models.seenFilters.notifications.every((filter) => String(filter.owner) === travelerId));
  assert.ok(models.seenFilters.histories.every((filter) => String(filter.owner) === travelerId));
  assert.ok(models.seenFilters.documents.every((filter) => String(filter.owner) === travelerId));
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes('Other traveler'), false);
  assert.equal(serialized.includes('storageProvider'), false);
});

test('dashboard returns empty summary when the authenticated traveler has no records', async () => {
  const response = await request(makeDashboardApp(createFixtureModels({ empty: true }))).get('/api/traveler/dashboard').set('Cookie', sessionCookie()).expect(200);
  assert.deepEqual(response.body.counts, { total: 0, valid: 0, expiringSoon: 0, expired: 0, pendingInformation: 0, notYetValid: 0 });
  assert.deepEqual(response.body.upcomingExpiries, []);
  assert.equal(response.body.nextUpcomingExpiry, null);
  assert.deepEqual(response.body.potentialOverstayWarnings, []);
});

test('expiry APIs are authenticated, owner-scoped, and return expiry and informational travel warnings', async () => {
  const app = makeDashboardApp(createFixtureModels());
  await request(app).get('/api/traveler/documents/expiry/summary').expect(401);
  const summary = await request(app).get('/api/traveler/documents/expiry/summary').set('Cookie', sessionCookie()).expect(200);
  assert.equal(summary.body.counts.total, 4);
  assert.equal(summary.body.nextUpcomingExpiry.displayName, 'Entry visa');
  const expired = await request(app).get('/api/traveler/documents/expiry/expired').set('Cookie', sessionCookie()).expect(200);
  assert.equal(expired.body.items[0].displayName, 'Old passport');
  const warnings = await request(app).get('/api/traveler/documents/expiry/potential-overstay-warnings').set('Cookie', sessionCookie()).expect(200);
  assert.equal(warnings.body.informationalOnly, true);
  assert.equal(warnings.body.items[0].warnings[0].type, 'expected_return_passed');
});

test('dashboard database failures return a safe generic server error', async () => {
  const models = createFixtureModels();
  models.TravelDocumentModel.countDocuments = () => Promise.reject(new Error('database connection string must not leak'));
  const response = await request(makeDashboardApp(models)).get('/api/traveler/dashboard').set('Cookie', sessionCookie()).expect(500);
  assert.equal(response.body.error.message, 'An unexpected server error occurred');
  assert.equal(JSON.stringify(response.body).includes('connection string'), false);
});

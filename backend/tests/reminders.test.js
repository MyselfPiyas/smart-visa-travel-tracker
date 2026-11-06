import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { createReminderScheduler } from '../src/services/reminder-scheduler.service.js';
import { createNotificationProcessor } from '../src/services/notification-processor.service.js';
import { buildNotificationEmail, isValidFromAddress } from '../src/services/notification-email.js';
import { calendarDaysBetween, localDateKey, localDateTimeToUtc } from '../src/utils/calendar-timezone.js';

const userId = '507f1f77bcf86cd799439011';
const documentId = '507f1f77bcf86cd799439012';
const tripId = '507f1f77bcf86cd799439013';
const day = (date) => new Date(`${date}T00:00:00.000Z`);
const query = (value) => ({ select() { return this; }, limit() { return this; }, lean: async () => value });

function schedulerHarness({ expiryDate, intervals = [90, 60, 30, 0], enabled = true, timeZone = 'UTC', now = day('2027-01-01') }) {
  const scheduled = new Map();
  const document = { _id: documentId, owner: userId, documentType: 'passport', displayName: 'Passport', expiryDate, reminderPreferences: { enabled: true }, updatedAt: now };
  const user = { _id: userId, name: 'Traveler', email: 'traveler@example.com', role: 'traveler', accountStatus: 'active', reminderPreferences: { enabled, emailEnabled: true, expiryIntervals: intervals }, profileSettings: { timeZone } };
  const DocumentModel = { find: () => query(expiryDate ? [document] : []) };
  const TravelHistoryModel = { find: () => query([]) };
  const UserModel = { find: () => query([user]) };
  const NotificationModel = { async updateOne(filter, update) { if (scheduled.has(filter.idempotencyKey)) return { upsertedCount: 0 }; scheduled.set(filter.idempotencyKey, update.$setOnInsert); return { upsertedCount: 1 }; } };
  const scheduler = createReminderScheduler({ DocumentModel, TravelHistoryModel, UserModel, NotificationModel, now: () => now, sendHour: () => 9 });
  return { scheduler, scheduled, now };
}

test('expiry scheduler creates the 90, 60, 30, and expiry-day reminders once', async () => {
  const { scheduler, scheduled } = schedulerHarness({ expiryDate: day('2027-04-01') });
  const first = await scheduler.scheduleExpiryNotifications();
  assert.equal(first.created, 4);
  assert.deepEqual([...scheduled.values()].map((item) => item.type), ['expiry_90_day', 'expiry_60_day', 'expiry_30_day', 'expiry_day']);
  assert.equal((await scheduler.scheduleExpiryNotifications()).created, 0);
});

test('disabled reminder preferences create no reminder records', async () => {
  const { scheduler, scheduled } = schedulerHarness({ expiryDate: day('2027-04-01'), enabled: false });
  assert.equal((await scheduler.scheduleExpiryNotifications()).created, 0);
  assert.equal(scheduled.size, 0);
});

test('scheduler catches up only the closest missed interval', async () => {
  const { scheduler, scheduled } = schedulerHarness({ expiryDate: day('2027-03-01'), now: day('2027-01-20') });
  assert.equal((await scheduler.scheduleExpiryNotifications()).created, 3);
  assert.deepEqual([...scheduled.values()].map((item) => item.type), ['expiry_60_day', 'expiry_30_day', 'expiry_day']);
});

test('local calendar conversion respects timezone offsets and DST', () => {
  assert.equal(calendarDaysBetween('2027-03-01', '2027-03-31'), 30);
  assert.equal(localDateKey(new Date('2027-01-01T01:00:00.000Z'), 'America/Los_Angeles'), '2026-12-31');
  assert.equal(localDateTimeToUtc('2027-07-01', 9, 'Asia/Kolkata').toISOString(), '2027-07-01T03:30:00.000Z');
  assert.equal(localDateTimeToUtc('2027-03-14', 9, 'America/New_York').toISOString(), '2027-03-14T13:00:00.000Z');
});

test('email templates include expiry details and omit token-like identifiers', () => {
  const email = buildNotificationEmail({ user: { name: 'A Traveler' }, notification: { type: 'expiry_30_day', expiryDateSnapshot: day('2027-04-01') }, document: { documentType: 'passport', displayName: 'Passport ABC12345678', expiryDate: day('2027-04-01') }, remainingDays: 30 });
  assert.match(email.subject, /30-day/);
  assert.match(email.text, /Days remaining: 30/);
  assert.doesNotMatch(email.text, /ABC12345678/);
  assert.equal(isValidFromAddress('Smart Visa Tracker <no-reply@example.com>'), true);
  assert.equal(isValidFromAddress('not-an-email'), false);
});

test('Nodemailer stream test transport renders a complete email without SMTP credentials', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const email = buildNotificationEmail({ user: { name: 'A Traveler' }, notification: { type: 'expiry_90_day', expiryDateSnapshot: day('2027-04-01') }, document: { documentType: 'passport', displayName: 'Passport', expiryDate: day('2027-04-01') }, remainingDays: 90 });
  const result = await transport.sendMail({ from: 'Tracker <noreply@example.com>', to: 'traveler@example.com', ...email });
  const message = result.message.toString().replace(/=\r?\n/g, '');
  assert.match(message, /90-day document reminder/i);
  assert.match(message, /traveler@example.com/i);
  assert.match(message, /Days remaining: 90/);
});

test('processor sends using an injected test transport and records attempt and success', async () => {
  let notification = { _id: 'notice1', owner: userId, type: 'expiry_30_day', deliveryStatus: 'pending', attemptCount: 0, scheduledAt: day('2027-01-01'), expiryDateSnapshot: day('2027-01-31'), reminderOffsetDays: 30, relatedDocument: documentId };
  const writes = [];
  const NotificationModel = {
    async findOneAndUpdate() { if (notification.deliveryStatus !== 'pending') return null; notification = { ...notification, deliveryStatus: 'processing', processingStartedAt: day('2027-01-01') }; return notification; },
    async updateOne(_filter, update) { writes.push(update); if (update.$inc) notification.attemptCount += update.$inc.attemptCount; if (update.$set) Object.assign(notification, update.$set); return { modifiedCount: 1 }; },
  };
  const UserModel = { findOne: () => ({ select() { return this; }, lean: async () => ({ _id: userId, name: 'Traveler', email: 'traveler@example.com', role: 'traveler', accountStatus: 'active', reminderPreferences: { enabled: true, emailEnabled: true, expiryIntervals: [30] }, profileSettings: { timeZone: 'UTC' } }) }) };
  const DocumentModel = { findOne: () => ({ select() { return this; }, lean: async () => ({ _id: documentId, owner: userId, documentType: 'passport', displayName: 'Passport', expiryDate: day('2027-01-31') }) }) };
  let mailed;
  const processor = createNotificationProcessor({ NotificationModel, UserModel, DocumentModel, transport: { sendMail: async (message) => { mailed = message; return { accepted: ['traveler@example.com'] }; } }, from: 'Tracker <noreply@example.com>', now: () => day('2027-01-01'), maxAttempts: () => 3 });
  const result = await processor.processDue();
  assert.equal(result.sent, 1);
  assert.equal(notification.deliveryStatus, 'sent');
  assert.equal(notification.attemptCount, 1);
  assert.match(mailed.text, /Days remaining: 30/);
  assert.ok(writes.some((update) => update.$set?.sentAt));
});

test('processor retries a failed SMTP delivery with bounded backoff and safe metadata', async () => {
  const updates = [];
  const notification = { _id: 'notice2', owner: userId, type: 'potential_overstay_warning', deliveryStatus: 'pending', attemptCount: 0, scheduledAt: day('2027-01-01'), relatedTravelHistory: tripId };
  let claimed = false;
  const NotificationModel = { async findOneAndUpdate() { if (claimed) return null; claimed = true; notification.deliveryStatus = 'processing'; return notification; }, async updateOne(_filter, update) { updates.push(update); if (update.$inc) notification.attemptCount += update.$inc.attemptCount; if (update.$set) Object.assign(notification, update.$set); } };
  const UserModel = { findOne: () => ({ select() { return this; }, lean: async () => ({ _id: userId, email: 'traveler@example.com', name: 'Traveler', accountStatus: 'active', reminderPreferences: { enabled: true, emailEnabled: true, potentialOverstayWarnings: true }, profileSettings: { timeZone: 'UTC' } }) }) };
  const TravelHistoryModel = { findOne: () => ({ select() { return this; }, lean: async () => ({ _id: tripId, owner: userId, destinationCountry: 'FR', returnDate: day('2026-12-01'), actualExitDate: null }) }) };
  const processor = createNotificationProcessor({ NotificationModel, UserModel, TravelHistoryModel, transport: { sendMail: async () => { const error = new Error('sensitive provider response'); error.code = 'ETIMEDOUT'; throw error; } }, from: 'noreply@example.com', now: () => day('2027-01-01'), maxAttempts: () => 4, retryBaseMs: () => 1000, retryMaxMs: () => 2000 });
  const result = await processor.processDue();
  assert.equal(result.retried, 1);
  assert.equal(notification.deliveryStatus, 'pending');
  assert.equal(notification.safeError.code, 'SMTP_CONNECTION_FAILED');
  assert.equal(JSON.stringify(notification.safeError).includes('sensitive'), false);
  assert.equal(notification.nextAttemptAt.toISOString(), '2027-01-01T00:00:01.000Z');
  assert.equal(updates[0].$inc.attemptCount, 1);
});

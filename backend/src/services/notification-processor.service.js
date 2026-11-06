import Notification from '../models/Notification.js';
import TravelDocument from '../models/TravelDocument.js';
import TravelHistory from '../models/TravelHistory.js';
import User from '../models/User.js';
import { calendarDateKey, calendarDaysBetween, localDateKey } from '../utils/calendar-timezone.js';
import { documentReminderIntervals, notificationAllowed, readReminderPreferences } from './reminder-preferences.service.js';
import { buildNotificationEmail, isValidFromAddress } from './notification-email.js';

const EXPIRY_OFFSETS = new Map([['expiry_90_day', 90], ['expiry_60_day', 60], ['expiry_30_day', 30], ['expiry_day', 0]]);

function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

function safeError(error) {
  const code = String(error?.code || error?.responseCode || '').toUpperCase();
  if (code === 'EAUTH') return { code: 'SMTP_AUTH_FAILED', category: 'configuration' };
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET', 'EDNS'].includes(code)) return { code: 'SMTP_CONNECTION_FAILED', category: 'network' };
  if (['EENVELOPE', 'EADDRESS', 'EINVALIDRECIPIENT'].includes(code)) return { code: 'SMTP_RECIPIENT_REJECTED', category: 'provider' };
  if (String(error?.code || '').includes('CONFIGURATION')) return { code: 'SMTP_CONFIGURATION_ERROR', category: 'configuration' };
  return { code: 'SMTP_DELIVERY_FAILED', category: 'provider' };
}

function safeUpdate(notification) {
  return { _id: notification._id, deliveryStatus: 'processing' };
}

export function createNotificationProcessor({
  NotificationModel = Notification,
  DocumentModel = TravelDocument,
  TravelHistoryModel = TravelHistory,
  UserModel = User,
  transport,
  from,
  now = () => new Date(),
  maxAttempts = () => Math.max(1, Math.min(10, Number(process.env.REMINDER_MAX_ATTEMPTS) || 5)),
  retryBaseMs = () => Math.max(1000, Number(process.env.REMINDER_RETRY_BASE_MS) || 5 * 60 * 1000),
  retryMaxMs = () => Math.max(1000, Number(process.env.REMINDER_RETRY_MAX_MS) || 6 * 60 * 60 * 1000),
  leaseMs = () => Math.max(60000, Number(process.env.REMINDER_PROCESSING_LEASE_MS) || 10 * 60 * 1000),
  appUrl = process.env.APP_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
} = {}) {
  let processing = false;

  async function claimNext() {
    const current = now();
    const expiredLease = new Date(current.getTime() - leaseMs());
    return NotificationModel.findOneAndUpdate({
      $or: [
        { deliveryStatus: 'pending', $or: [{ nextAttemptAt: { $lte: current } }, { nextAttemptAt: null, scheduledAt: { $lte: current } }] },
        { deliveryStatus: 'processing', processingStartedAt: { $lte: expiredLease } },
      ],
    }, {
      $set: { deliveryStatus: 'processing', processingStartedAt: current },
    }, { new: true, sort: { nextAttemptAt: 1, scheduledAt: 1 } });
  }

  async function validateRecord(notification, user, preferences) {
    if (!user || user.accountStatus !== 'active' || !validEmail(user.email)) return { allowed: false, reason: !user || user.accountStatus !== 'active' ? 'cancel' : 'invalid_email' };
    if (!notificationAllowed(notification.type, preferences, notification.reminderOffsetDays ?? null)) return { allowed: false, reason: 'paused' };

    const offset = EXPIRY_OFFSETS.get(notification.type);
    if (offset !== undefined || ['expired_document_warning', 'important_document_information'].includes(notification.type)) {
      const document = notification.relatedDocument && await DocumentModel.findOne({ _id: notification.relatedDocument, owner: notification.owner, status: { $ne: 'archived' } })
        .select('documentType displayName expiryDate validFrom reminderPreferences').lean();
      if (!document) return { allowed: false, reason: 'cancel' };
      if (offset !== undefined) {
        if (documentReminderIntervals(document, preferences).includes(offset) === false) return { allowed: false, reason: 'paused' };
        if (calendarDateKey(document.expiryDate) !== calendarDateKey(notification.expiryDateSnapshot)) return { allowed: false, reason: 'cancel' };
      } else if (notification.type === 'expired_document_warning') {
        if (document.reminderPreferences?.enabled === false) return { allowed: false, reason: 'paused' };
        const today = localDateKey(now(), preferences.timeZone);
        if (!document.expiryDate || calendarDateKey(document.expiryDate) >= today) return { allowed: false, reason: 'cancel' };
        if (calendarDateKey(document.expiryDate) !== calendarDateKey(notification.expiryDateSnapshot)) return { allowed: false, reason: 'cancel' };
      } else {
        if (document.reminderPreferences?.enabled === false) return { allowed: false, reason: 'paused' };
        if (document.expiryDate && (document.documentType !== 'visa' || document.validFrom)) return { allowed: false, reason: 'cancel' };
      }
      return { allowed: true, document };
    }

    if (notification.type === 'potential_overstay_warning') {
      const trip = notification.relatedTravelHistory && await TravelHistoryModel.findOne({ _id: notification.relatedTravelHistory, owner: notification.owner, actualExitDate: null })
        .select('destinationCountry returnDate actualExitDate').lean();
      if (!trip || !trip.returnDate || !notificationAllowed(notification.type, preferences)) return { allowed: false, reason: 'cancel' };
      const today = localDateKey(now(), preferences.timeZone);
      if (calendarDateKey(trip.returnDate) >= today) return { allowed: false, reason: 'cancel' };
      return { allowed: true, trip };
    }
    return { allowed: true };
  }

  async function finishCancelled(notification, reason = null) {
    await NotificationModel.updateOne(safeUpdate(notification), {
      $set: { deliveryStatus: reason ? 'failed' : 'cancelled', processingStartedAt: null, ...(reason ? { safeError: reason } : {}), nextAttemptAt: null },
    });
  }

  async function sendOne(notification) {
    const user = await UserModel.findOne({ _id: notification.owner }).select('name email role accountStatus reminderPreferences profileSettings.timeZone').lean();
    const preferences = readReminderPreferences(user);
    const context = await validateRecord(notification, user, preferences);
    if (!context.allowed) {
      if (context.reason === 'paused') {
        await NotificationModel.updateOne(safeUpdate(notification), { $set: { deliveryStatus: 'pending', processingStartedAt: null, nextAttemptAt: new Date(now().getTime() + 6 * 60 * 60 * 1000) } });
        return 'deferred';
      }
      await finishCancelled(notification, context.reason === 'invalid_email' ? { code: 'INVALID_RECIPIENT', category: 'configuration' } : null);
      return context.reason === 'invalid_email' ? 'failed' : 'cancelled';
    }
    if (!transport || typeof transport.sendMail !== 'function' || !isValidFromAddress(from)) {
      await NotificationModel.updateOne(safeUpdate(notification), { $set: { deliveryStatus: 'failed', processingStartedAt: null, safeError: { code: 'SMTP_CONFIGURATION_ERROR', category: 'configuration' }, nextAttemptAt: null } });
      return 'failed';
    }

    const attemptCount = Number(notification.attemptCount || 0) + 1;
    await NotificationModel.updateOne(safeUpdate(notification), { $inc: { attemptCount: 1 }, $set: { lastAttemptAt: now() } });
    const remainingDays = context.document?.expiryDate
        ? calendarDaysBetween(localDateKey(now(), preferences.timeZone), calendarDateKey(context.document.expiryDate))
        : null;
    const email = buildNotificationEmail({ user, notification, document: context.document, travel: context.trip, remainingDays, appUrl });
    try {
      const info = await transport.sendMail({ from, to: user.email, ...email });
      if (info?.rejected?.some((address) => address.toLowerCase() === user.email.toLowerCase())) {
        const error = new Error('Recipient rejected'); error.code = 'EENVELOPE'; throw error;
      }
    } catch (error) {
      const failure = safeError(error);
      if (attemptCount >= maxAttempts()) {
        await NotificationModel.updateOne(safeUpdate(notification), { $set: { deliveryStatus: 'failed', safeError: failure, processingStartedAt: null, nextAttemptAt: null } });
        return 'failed';
      }
      const delay = Math.min(retryBaseMs() * (2 ** (attemptCount - 1)), retryMaxMs());
      await NotificationModel.updateOne(safeUpdate(notification), { $set: { deliveryStatus: 'pending', safeError: failure, processingStartedAt: null, nextAttemptAt: new Date(now().getTime() + delay) } });
      return 'retry';
    }
    // If SMTP accepted the email but this write fails, leave the processing lease
    // intact. A later lease recovery may retry, but we avoid treating a database
    // outage as a known SMTP failure and immediately re-queueing the message.
    await NotificationModel.updateOne(safeUpdate(notification), { $set: { deliveryStatus: 'sent', sentAt: now(), processingStartedAt: null, nextAttemptAt: null }, $unset: { safeError: 1 } });
    return 'sent';
  }

  async function processDue({ batchSize = 50 } = {}) {
    if (processing) return { skipped: true, sent: 0, failed: 0, retried: 0, cancelled: 0 };
    processing = true;
    const results = { skipped: false, sent: 0, failed: 0, retried: 0, cancelled: 0, deferred: 0 };
    try {
      const limit = Math.max(1, Math.min(500, Number(batchSize) || 50));
      for (let index = 0; index < limit; index += 1) {
        const notification = await claimNext();
        if (!notification) break;
        const result = await sendOne(notification);
        if (result === 'sent') results.sent += 1;
        else if (result === 'failed') results.failed += 1;
        else if (result === 'retry') results.retried += 1;
        else if (result === 'deferred') results.deferred += 1;
        else results.cancelled += 1;
      }
      return results;
    } finally { processing = false; }
  }

  return { processDue, claimNext };
}

export { safeError as safeSmtpError, validEmail as isValidRecipientEmail };

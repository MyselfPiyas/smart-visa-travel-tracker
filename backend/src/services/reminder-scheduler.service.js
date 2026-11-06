import TravelDocument from '../models/TravelDocument.js';
import TravelHistory from '../models/TravelHistory.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { calendarDateKey, calendarDaysBetween, localDateKey, localDateTimeToUtc, shiftDateKey } from '../utils/calendar-timezone.js';
import { documentReminderIntervals, notificationAllowed, readReminderPreferences } from './reminder-preferences.service.js';

const OFFSET_TO_TYPE = new Map([[90, 'expiry_90_day'], [60, 'expiry_60_day'], [30, 'expiry_30_day'], [0, 'expiry_day']]);

function idOf(value) { return String(value?._id || value?.id || value); }

export function createReminderScheduler({
  DocumentModel = TravelDocument,
  TravelHistoryModel = TravelHistory,
  NotificationModel = Notification,
  UserModel = User,
  now = () => new Date(),
  sendHour = () => Number(process.env.REMINDER_SEND_HOUR) || 9,
  expiredWindowDays = () => Math.max(1, Math.min(3650, Number(process.env.REMINDER_EXPIRED_WINDOW_DAYS) || 365)),
} = {}) {
  async function schedule(record) {
    try {
      const result = await NotificationModel.updateOne(
        { idempotencyKey: record.idempotencyKey },
        { $setOnInsert: { ...record, deliveryStatus: 'pending', attemptCount: 0, nextAttemptAt: record.scheduledAt } },
        { upsert: true, runValidators: true },
      );
      return Number(result.upsertedCount || result.upsertedId ? 1 : 0);
    } catch (error) {
      // Multiple worker instances can race on the same upsert. The unique
      // idempotency index wins; treat its duplicate-key loser as already queued.
      if (error?.code === 11000) return 0;
      throw error;
    }
  }

  async function scheduleExpiryNotifications() {
    const current = now();
    const utcKey = calendarDateKey(current);
    const fetchFrom = new Date(`${shiftDateKey(utcKey, -expiredWindowDays() - 2)}T00:00:00.000Z`);
    const fetchUntil = new Date(`${shiftDateKey(utcKey, 93)}T00:00:00.000Z`);
    const [datedDocuments, missingDateDocuments] = await Promise.all([
      DocumentModel.find({ status: { $ne: 'archived' }, expiryDate: { $gte: fetchFrom, $lt: fetchUntil } })
        .select('owner documentType displayName expiryDate validFrom reminderPreferences updatedAt').limit(10000).lean(),
      DocumentModel.find({ status: { $ne: 'archived' }, $or: [{ expiryDate: null }, { expiryDate: { $exists: false } }] })
        .select('owner documentType displayName expiryDate validFrom reminderPreferences updatedAt').limit(10000).lean(),
    ]);
    const uniqueDocs = new Map([...datedDocuments, ...missingDateDocuments].map((item) => [idOf(item), item]));
    const documents = [...uniqueDocs.values()];
    const ownerIds = [...new Set(documents.map((document) => idOf(document.owner)))];
    if (ownerIds.length === 0) return { created: 0, scannedDocuments: 0 };
    const users = await UserModel.find({ _id: { $in: ownerIds }, role: 'traveler', accountStatus: 'active' })
      .select('name email reminderPreferences profileSettings.timeZone').lean();
    const usersById = new Map(users.map((user) => [idOf(user), user]));
    let created = 0;

    for (const document of documents) {
      const user = usersById.get(idOf(document.owner));
      if (!user) continue;
      const preferences = readReminderPreferences(user);
      if (!preferences.enabled || !preferences.emailEnabled) continue;
      const documentEnabled = document.reminderPreferences?.enabled !== false;
      const intervalPreferences = documentReminderIntervals(document, preferences);
      const expiryKey = calendarDateKey(document.expiryDate);

      if (expiryKey && documentEnabled) {
        const todayKey = localDateKey(current, preferences.timeZone);
        const daysRemaining = calendarDaysBetween(todayKey, expiryKey);
        const dueIntervals = intervalPreferences.filter((offset) => shiftDateKey(expiryKey, -offset) <= todayKey);
        const catchUpOffset = dueIntervals.length ? Math.min(...dueIntervals) : null;
        for (const offset of intervalPreferences) {
          const targetDay = shiftDateKey(expiryKey, -offset);
          const isUpcoming = targetDay >= todayKey;
          if (!isUpcoming && offset !== catchUpOffset) continue;
          const type = OFFSET_TO_TYPE.get(offset);
          if (!type || !notificationAllowed(type, preferences, offset)) continue;
          const scheduledAt = localDateTimeToUtc(targetDay, sendHour(), preferences.timeZone);
          created += await schedule({
            owner: user._id,
            relatedDocument: document._id,
            type,
            scheduledAt,
            expiryDateSnapshot: new Date(`${expiryKey}T00:00:00.000Z`),
            reminderOffsetDays: offset,
            idempotencyKey: `expiry:${idOf(user)}:${idOf(document)}:${expiryKey}:${offset}`,
          });
        }
        if (daysRemaining < 0 && documentEnabled && preferences.expiredDocumentWarnings && notificationAllowed('expired_document_warning', preferences)) {
          const overdueDays = Math.abs(daysRemaining);
          if (overdueDays <= expiredWindowDays()) {
            const warningDay = shiftDateKey(expiryKey, 1);
            created += await schedule({
              owner: user._id,
              relatedDocument: document._id,
              type: 'expired_document_warning',
              scheduledAt: localDateTimeToUtc(warningDay, sendHour(), preferences.timeZone),
              expiryDateSnapshot: new Date(`${expiryKey}T00:00:00.000Z`),
              idempotencyKey: `expired:${idOf(user)}:${idOf(document)}:${expiryKey}`,
            });
          }
        }
      }

      const visaNeedsStart = document.documentType === 'visa' && !document.validFrom;
      if (documentEnabled && (!expiryKey || visaNeedsStart) && notificationAllowed('important_document_information', preferences)) {
        created += await schedule({
          owner: user._id,
          relatedDocument: document._id,
          type: 'important_document_information',
          scheduledAt: current,
          idempotencyKey: `document-info:${idOf(user)}:${idOf(document)}`,
        });
      }
    }
    return { created, scannedDocuments: documents.length };
  }

  async function scheduleOverstayWarnings() {
    const current = now();
    const utcToday = calendarDateKey(current);
    const fetchUntil = new Date(`${shiftDateKey(utcToday, 2)}T00:00:00.000Z`);
    const trips = await TravelHistoryModel.find({ returnDate: { $lt: fetchUntil }, actualExitDate: null })
      .select('owner destinationCountry returnDate actualExitDate').limit(5000).lean();
    if (!trips.length) return { created: 0, scannedTrips: 0 };
    const ownerIds = [...new Set(trips.map((trip) => idOf(trip.owner)))];
    const users = await UserModel.find({ _id: { $in: ownerIds }, role: 'traveler', accountStatus: 'active' })
      .select('name email reminderPreferences profileSettings.timeZone').lean();
    const usersById = new Map(users.map((user) => [idOf(user), user]));
    let created = 0;
    for (const trip of trips) {
      const user = usersById.get(idOf(trip.owner));
      if (!user) continue;
      const preferences = readReminderPreferences(user);
      if (calendarDateKey(trip.returnDate) >= localDateKey(current, preferences.timeZone)) continue;
      if (!notificationAllowed('potential_overstay_warning', preferences)) continue;
      created += await schedule({
        owner: user._id,
        relatedTravelHistory: trip._id,
        type: 'potential_overstay_warning',
        scheduledAt: localDateTimeToUtc(localDateKey(current, preferences.timeZone), sendHour(), preferences.timeZone),
        idempotencyKey: `overstay:${idOf(user)}:${idOf(trip)}`,
      });
    }
    return { created, scannedTrips: trips.length };
  }

  async function runOnce() {
    const [expiry, overstay] = await Promise.all([scheduleExpiryNotifications(), scheduleOverstayWarnings()]);
    return { created: expiry.created + overstay.created, expiry, overstay };
  }

  return { runOnce, scheduleExpiryNotifications, scheduleOverstayWarnings };
}

export default createReminderScheduler();

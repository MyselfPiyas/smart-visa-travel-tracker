import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import TravelDocument from '../models/TravelDocument.js';
import TravelHistory from '../models/TravelHistory.js';
import { createExpiryTrackingService } from './expiry-tracking.service.js';

function asDate(value) { return value instanceof Date ? value : new Date(value); }

export function createDashboardService({
  TravelDocumentModel,
  DocumentModel = TravelDocumentModel || TravelDocument,
  NotificationModel = Notification,
  TravelHistoryModel = TravelHistory,
  now = () => new Date(),
} = {}) {
  const expiryTracking = createExpiryTrackingService({ DocumentModel, TravelHistoryModel, now });
  return async function getDashboard(user) {
    const ownerId = new mongoose.Types.ObjectId(user.id);
    const currentTime = now();
    const currentDay = new Date(`${currentTime.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const [expirySummary, potentialOverstayWarnings, upcomingReminders, recentNotifications, recentTravelHistory, upcomingTrips, totalTravelRecords] = await Promise.all([
      expiryTracking.getSummary(ownerId),
      expiryTracking.getPotentialOverstayWarnings(ownerId),
      NotificationModel.find({ owner: ownerId, deliveryStatus: 'pending', scheduledAt: { $gte: currentTime } }).sort({ scheduledAt: 1 }).limit(3).select('type scheduledAt deliveryStatus').lean(),
      NotificationModel.find({ owner: ownerId }).sort({ createdAt: -1 }).limit(5).select('type deliveryStatus createdAt sentAt').lean(),
      TravelHistoryModel.find({ owner: ownerId, departureDate: { $lt: currentDay } }).sort({ departureDate: -1 }).limit(5).select('destinationCountry purpose departureDate returnDate').lean(),
      TravelHistoryModel.find({ owner: ownerId, departureDate: { $gte: currentDay } }).sort({ departureDate: 1 }).limit(5).select('destinationCountry purpose departureDate returnDate visaDocument').lean(),
      TravelHistoryModel.countDocuments({ owner: ownerId }),
    ]);

    return {
      counts: expirySummary.counts,
      thresholds: expirySummary.thresholds,
      nextUpcomingExpiry: expirySummary.nextUpcomingExpiry,
      upcomingReminders: upcomingReminders.map((item) => ({ type: item.type, scheduledAt: asDate(item.scheduledAt), deliveryStatus: item.deliveryStatus })),
      recentNotifications: recentNotifications.map((item) => ({ type: item.type, deliveryStatus: item.deliveryStatus, createdAt: asDate(item.createdAt), sentAt: item.sentAt ? asDate(item.sentAt) : null })),
      recentTravelHistory: recentTravelHistory.map((item) => ({ destinationCountry: item.destinationCountry, purpose: item.purpose, departureDate: asDate(item.departureDate), returnDate: item.returnDate ? asDate(item.returnDate) : null })),
      upcomingTrips: upcomingTrips.map((item) => ({ destinationCountry: item.destinationCountry, purpose: item.purpose, departureDate: asDate(item.departureDate), returnDate: item.returnDate ? asDate(item.returnDate) : null })),
      totalTravelRecords,
      recentlyVisitedCountries: [...new Set(recentTravelHistory.map((item) => item.destinationCountry))].slice(0, 5),
      upcomingExpiries: expirySummary.upcomingExpiries,
      potentialOverstayWarnings,
    };
  };
}

export default createDashboardService();

import mongoose from 'mongoose';
import { DELIVERY_STATUSES, NOTIFICATION_TYPES } from './enums.js';

const safeErrorSchema = new mongoose.Schema({
  code: { type: String, trim: true, maxlength: 80, match: [/^[A-Z0-9_.-]+$/i, 'Use a short safe error code.'] },
  category: { type: String, enum: ['provider', 'network', 'configuration', 'unknown'] },
}, { _id: false, strict: 'throw' });

const notificationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  relatedDocument: { type: mongoose.Schema.Types.ObjectId, ref: 'TravelDocument', default: null },
  relatedTravelHistory: { type: mongoose.Schema.Types.ObjectId, ref: 'TravelHistory', default: null },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  scheduledAt: { type: Date, required: true },
  nextAttemptAt: { type: Date, default: function nextAttempt() { return this.scheduledAt; } },
  expiryDateSnapshot: { type: Date, default: null },
  reminderOffsetDays: { type: Number, min: 0, max: 365, default: null },
  deliveryStatus: { type: String, enum: DELIVERY_STATUSES, default: 'pending', required: true },
  attemptCount: { type: Number, min: 0, max: 100, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  processingStartedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  readAt: { type: Date, default: null },
  safeError: { type: safeErrorSchema, default: undefined },
  idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 200, select: false },
}, { timestamps: true, strict: 'throw' });

notificationSchema.index({ idempotencyKey: 1 }, { unique: true, name: 'notification_idempotency_unique' });
notificationSchema.index({ deliveryStatus: 1, nextAttemptAt: 1 }, { name: 'notification_due_queue' });
notificationSchema.index({ owner: 1, createdAt: -1 }, { name: 'notification_owner_created' });
notificationSchema.index({ owner: 1, deliveryStatus: 1, scheduledAt: 1 }, { name: 'notification_owner_upcoming' });
notificationSchema.index({ deliveryStatus: 1, processingStartedAt: 1 }, { name: 'notification_worker_lease' });

export default mongoose.model('Notification', notificationSchema);

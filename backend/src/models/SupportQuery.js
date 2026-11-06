import mongoose from 'mongoose';
import { SUPPORT_STATUSES } from './enums.js';

const adminResponseSchema = new mongoose.Schema({
  message: { type: String, trim: true, maxlength: 5000 },
  respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  respondedAt: { type: Date },
}, { _id: false, strict: 'throw' });

const supportMessageSchema = new mongoose.Schema({
  authorType: { type: String, enum: ['traveler', 'admin'], required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  message: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
  createdAt: { type: Date, default: Date.now, required: true },
}, { _id: true, strict: 'throw' });

const supportQuerySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  subject: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  message: { type: String, required: true, trim: true, minlength: 5, maxlength: 5000 },
  status: { type: String, enum: SUPPORT_STATUSES, default: 'open', required: true },
  adminResponse: { type: adminResponseSchema, default: undefined },
  messages: { type: [supportMessageSchema], default: [] },
}, { timestamps: true, strict: 'throw' });

supportQuerySchema.index({ status: 1, createdAt: 1 }, { name: 'support_queue' });
supportQuerySchema.index({ status: 1, updatedAt: -1 }, { name: 'support_status_updated' });
supportQuerySchema.index({ user: 1, createdAt: -1 }, { name: 'support_user_created' });

export default mongoose.model('SupportQuery', supportQuerySchema);

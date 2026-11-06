import mongoose from 'mongoose';
import { ACCOUNT_STATUSES, USER_ROLES } from './enums.js';

const reminderPreferencesSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: true },
  emailEnabled: { type: Boolean, default: true },
  expiryIntervals: { type: [Number], default: [90, 60, 30, 0], validate: { validator: (values) => values.every((value) => [90, 60, 30, 0].includes(value)), message: 'Choose supported expiry reminder intervals.' } },
  expiredDocumentWarnings: { type: Boolean, default: true },
  potentialOverstayWarnings: { type: Boolean, default: true },
  importantDocumentInformation: { type: Boolean, default: true },
}, { _id: false });

const profileSettingsSchema = new mongoose.Schema({
  displayName: { type: String, trim: true, maxlength: 80 },
  locale: { type: String, trim: true, maxlength: 20, default: 'en' },
  timeZone: { type: String, trim: true, maxlength: 64, default: 'UTC', validate: { validator: (value) => { try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; } }, message: 'Enter a valid IANA timezone.' } },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  contactNumber: { type: String, trim: true, maxlength: 32, default: '' },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'] },
  passwordHash: { type: String, required: true, select: false, minlength: 20, maxlength: 255 },
  role: { type: String, enum: USER_ROLES, default: 'traveler', required: true },
  accountStatus: { type: String, enum: ACCOUNT_STATUSES, default: 'pending', required: true },
  reminderPreferences: { type: reminderPreferencesSchema, default: () => ({}) },
  profileSettings: { type: profileSettingsSchema, default: () => ({}) },
}, { timestamps: true, strict: 'throw' });

userSchema.index({ email: 1 }, { unique: true, name: 'user_email_unique' });
userSchema.index({ role: 1, accountStatus: 1 }, { name: 'user_role_status' });
userSchema.index({ role: 1, createdAt: -1 }, { name: 'user_role_created' });

export default mongoose.model('User', userSchema);

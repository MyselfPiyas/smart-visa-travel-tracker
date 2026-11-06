import mongoose from 'mongoose';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, VISA_ENTRY_TYPES } from './enums.js';

const fileMetadataSchema = new mongoose.Schema({
  mimeType: { type: String, trim: true, maxlength: 120 },
  sizeBytes: { type: Number, min: 0, max: 50 * 1024 * 1024 },
  checksumSha256: { type: String, match: [/^[a-f\d]{64}$/i, 'Checksum must be a SHA-256 hex digest.'] },
}, { _id: false, strict: 'throw' });

const attachmentSchema = new mongoose.Schema({
  storageProvider: { type: String, enum: ['private_local', 's3', 'azure_blob'], default: 'private_local', required: true },
  objectKey: { type: String, required: true, trim: true, maxlength: 120, select: false },
  originalName: { type: String, required: true, trim: true, maxlength: 160 },
  metadata: { type: fileMetadataSchema, required: true },
  uploadedAt: { type: Date, default: Date.now, required: true },
}, { timestamps: false, strict: 'throw' });

const documentSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  documentType: { type: String, enum: DOCUMENT_TYPES, required: true },
  displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  issuingCountry: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2, match: [/^[A-Z]{2}$/, 'Use a two-letter country code.'] },
  issueDate: { type: Date, default: null },
  expiryDate: { type: Date, default: null },
  // Visa-specific validity window; expiryDate is the shared valid-until date.
  validFrom: { type: Date, default: null },
  visaEntryType: { type: String, enum: VISA_ENTRY_TYPES, default: undefined },
  allowedStayDays: { type: Number, min: 1, max: 730, default: undefined },
  status: { type: String, enum: DOCUMENT_STATUSES, default: 'valid', required: true },
  // `file` remains optional for older records. New uploads use `files` so a
  // document can have multiple supporting attachments.
  file: { storageProvider: { type: String, enum: ['s3', 'azure_blob', 'private_local'] }, objectKey: { type: String, trim: true, maxlength: 512, select: false }, metadata: { type: fileMetadataSchema, default: undefined } },
  files: { type: [attachmentSchema], default: [], validate: { validator: (items) => items.length <= 5, message: 'A document may have at most 5 attachments.' } },
  reminderPreferences: { enabled: { type: Boolean, default: true }, daysBeforeExpiry: { type: [Number], default: undefined, validate: { validator: (items) => !items || items.every((value) => Number.isInteger(value) && value >= 0 && value <= 365), message: 'Reminder days must be whole numbers from 0 to 365.' } } },
}, { timestamps: true, strict: 'throw' });

documentSchema.path('expiryDate').validate(function validateDate(value) { return !value || !this.issueDate || value >= this.issueDate; }, 'Expiry date must be on or after issue date.');
documentSchema.path('expiryDate').validate(function validateVisaDate(value) { return this.documentType !== 'visa' || !value || !this.validFrom || value >= this.validFrom; }, 'Visa valid-until date must be on or after valid-from date.');
documentSchema.index({ owner: 1, expiryDate: 1 }, { name: 'document_owner_expiry' });
documentSchema.index({ expiryDate: 1, status: 1 }, { name: 'document_expiry_status' });
documentSchema.index({ owner: 1, createdAt: -1 }, { name: 'document_owner_created' });
documentSchema.index({ owner: 1, documentType: 1, expiryDate: 1 }, { name: 'document_owner_type_expiry' });
documentSchema.index({ owner: 1, validFrom: 1, expiryDate: 1 }, { name: 'document_owner_visa_validity' });

export default mongoose.model('TravelDocument', documentSchema);

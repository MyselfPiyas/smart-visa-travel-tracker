import mongoose from 'mongoose';
import { REQUIREMENT_TYPES, TRAVEL_PURPOSES } from './enums.js';

const destinationRequirementSchema = new mongoose.Schema({
  destinationCountry: { type: String, required: true, trim: true, uppercase: true, minlength: 2, maxlength: 2, match: [/^[A-Z]{2}$/, 'Use a two-letter country code.'] },
  nationality: { type: String, required: true, trim: true, uppercase: true, minlength: 2, maxlength: 2, match: [/^[A-Z]{2}$/, 'Use a two-letter country code.'] },
  purpose: { type: String, enum: [...TRAVEL_PURPOSES, 'any'], default: 'any', required: true },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
  description: { type: String, required: true, trim: true, minlength: 1, maxlength: 3000 },
  requirementType: { type: String, enum: REQUIREMENT_TYPES, required: true },
  officialSourceUrl: { type: String, required: true, trim: true, maxlength: 2048, validate: { validator(value) { try { const url = new URL(value); return url.protocol === 'https:'; } catch { return false; } }, message: 'Provide a valid HTTPS official source URL.' } },
  lastVerifiedAt: { type: Date, default: null, validate: { validator: (value) => !value || value <= new Date(), message: 'Last verified date cannot be in the future.' } },
  active: { type: Boolean, default: true },
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, strict: 'throw' });

destinationRequirementSchema.index({ destinationCountry: 1, nationality: 1, purpose: 1, active: 1 }, { name: 'destination_match_active' });
destinationRequirementSchema.index({ active: 1, destinationCountry: 1, title: 1 }, { name: 'destination_active_search' });
destinationRequirementSchema.index({ lastVerifiedAt: 1 }, { name: 'destination_last_verified' });

export default mongoose.model('DestinationRequirement', destinationRequirementSchema);

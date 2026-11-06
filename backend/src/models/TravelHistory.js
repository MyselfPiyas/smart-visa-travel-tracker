import mongoose from 'mongoose';
import { TRAVEL_PURPOSES } from './enums.js';

const travelHistorySchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  destinationCountry: { type: String, required: true, trim: true, uppercase: true, minlength: 2, maxlength: 2, match: [/^[A-Z]{2}$/, 'Use a two-letter country code.'] },
  purpose: { type: String, enum: TRAVEL_PURPOSES, required: true },
  departureDate: { type: Date, required: true },
  returnDate: { type: Date, default: null },
  // User-reported border entry/exit dates; separate trip records are the visa usage history.
  actualEntryDate: { type: Date, default: null },
  actualExitDate: { type: Date, default: null },
  visaDocument: { type: mongoose.Schema.Types.ObjectId, ref: 'TravelDocument', default: null },
  relatedDocuments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TravelDocument' }],
  notes: { type: String, trim: true, maxlength: 2000 },
}, { timestamps: true, strict: 'throw' });

travelHistorySchema.path('returnDate').validate(function validateDate(value) { return !value || value >= this.departureDate; }, 'Return date must be on or after departure date.');
travelHistorySchema.path('actualEntryDate').validate(function validateEntryDate(value) { return !value || value >= this.departureDate; }, 'Recorded entry date must be on or after departure date.');
travelHistorySchema.path('actualEntryDate').validate(function validateEntryBeforeReturn(value) { return !value || !this.returnDate || value <= this.returnDate; }, 'Recorded entry date must be on or before planned return date.');
travelHistorySchema.path('actualExitDate').validate(function validateExitDate(value) { return !value || !this.actualEntryDate || value >= this.actualEntryDate; }, 'Recorded exit date must be on or after entry date.');
travelHistorySchema.path('actualExitDate').validate(function validateExitBeforeReturn(value) { return !value || !this.returnDate || value <= this.returnDate; }, 'Recorded exit date must be on or before planned return date.');
travelHistorySchema.index({ owner: 1, departureDate: -1 }, { name: 'travel_owner_departure' });
travelHistorySchema.index({ owner: 1, destinationCountry: 1, departureDate: -1 }, { name: 'travel_owner_country_departure' });
travelHistorySchema.index({ owner: 1, purpose: 1, departureDate: -1 }, { name: 'travel_owner_purpose_departure' });
travelHistorySchema.index({ destinationCountry: 1, departureDate: -1 }, { name: 'travel_destination_departure' });
travelHistorySchema.index({ owner: 1, returnDate: 1, actualExitDate: 1 }, { name: 'travel_owner_open_return' });
travelHistorySchema.index({ owner: 1, actualEntryDate: 1, actualExitDate: 1 }, { name: 'travel_owner_open_entry' });

export default mongoose.model('TravelHistory', travelHistorySchema);

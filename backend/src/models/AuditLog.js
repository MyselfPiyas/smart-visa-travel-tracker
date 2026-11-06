import mongoose from 'mongoose';
import { RESOURCE_TYPES } from './enums.js';

const safeMetadataSchema = new mongoose.Schema({
  requestId: { type: String, trim: true, maxlength: 80, match: [/^[a-zA-Z0-9_.:-]*$/, 'Use a safe request identifier.'] },
  result: { type: String, enum: ['success', 'failure'] },
  reasonCode: { type: String, trim: true, maxlength: 80, match: [/^[a-z][a-z0-9_.-]*$/i, 'Use a short reason code.'] },
  changedFields: { type: [String], default: [], validate: { validator: (fields) => fields.every((field) => ['role', 'accountStatus', 'name', 'contactNumber', 'displayName', 'locale', 'timeZone', 'reminderPreferences', 'documentStatus', 'documentMetadata', 'documentFile', 'destinationCountry', 'requirementStatus', 'supportStatus', 'nationality', 'purpose', 'requirementTitle', 'requirementDescription', 'requirementType', 'officialSourceUrl', 'lastVerifiedAt', 'active', 'travelRecord', 'travelDates'].includes(field)), message: 'Audit logs may record only allow-listed field names.' } },
}, { _id: false, strict: 'throw' });

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true, trim: true, lowercase: true, match: [/^[a-z][a-z0-9_.-]{1,79}$/, 'Use a short action identifier.'] },
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true },
  resourceId: { type: String, trim: true, maxlength: 100, default: null },
  occurredAt: { type: Date, default: Date.now, required: true },
  metadata: { type: safeMetadataSchema, default: () => ({}) },
}, { timestamps: true, strict: 'throw' });

auditLogSchema.index({ actor: 1, occurredAt: -1 }, { name: 'audit_actor_time' });
auditLogSchema.index({ resourceType: 1, resourceId: 1, occurredAt: -1 }, { name: 'audit_resource_time' });

export default mongoose.model('AuditLog', auditLogSchema);

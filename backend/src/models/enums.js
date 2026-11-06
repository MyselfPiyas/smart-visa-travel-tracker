export const USER_ROLES = ['traveler', 'admin'];
export const ACCOUNT_STATUSES = ['pending', 'active', 'suspended'];
export const DOCUMENT_TYPES = ['passport', 'visa', 'travel_insurance', 'vaccination_certificate', 'residence_permit', 'other'];
export const DOCUMENT_STATUSES = ['valid', 'expiring', 'expiring_soon', 'expired', 'pending_information', 'not_yet_valid', 'archived'];
export const VISA_ENTRY_TYPES = ['single_entry', 'multiple_entry'];
// Keep older values accepted so existing travel records remain valid.
export const TRAVEL_PURPOSES = ['tourism', 'business', 'education', 'employment', 'family_visit', 'medical', 'transit', 'other', 'study', 'work', 'family'];
export const NOTIFICATION_TYPES = ['expiry_reminder', 'expiry_90_day', 'expiry_60_day', 'expiry_30_day', 'expiry_day', 'expired_document_warning', 'potential_overstay_warning', 'important_document_information', 'travel_reminder', 'system', 'support_update'];
export const DELIVERY_STATUSES = ['pending', 'processing', 'sent', 'failed', 'cancelled'];
export const REQUIREMENT_TYPES = ['required', 'conditional', 'informational'];
// `answered` remains accepted for records created before Part 13.
export const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting_for_user', 'resolved', 'closed', 'answered'];
export const RESOURCE_TYPES = ['user', 'travel_document', 'travel_history', 'notification', 'destination_requirement', 'support_query'];

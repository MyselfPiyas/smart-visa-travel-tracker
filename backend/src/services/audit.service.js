/** Persist a deliberately small audit event. Callers must pass identifiers and
 * allow-listed metadata only; never pass request bodies, filenames or secrets. */
export function recordAudit({ AuditLogModel, actor = null, action, resourceType, resourceId = null, occurredAt = new Date(), metadata = { result: 'success' } }) {
  if (!AuditLogModel?.create) throw new Error('Audit log storage is unavailable.');
  return AuditLogModel.create({ actor, action, resourceType, resourceId: resourceId ? String(resourceId) : null, occurredAt, metadata });
}

export function logAuditFailure(error) {
  // Keep diagnostics free of event payloads, request data and credentials.
  console.error('Audit write failed:', error?.name || 'Error');
}

export async function recordAuditBestEffort(event) {
  try { return await recordAudit(event); }
  catch (error) { logAuditFailure(error); return null; }
}

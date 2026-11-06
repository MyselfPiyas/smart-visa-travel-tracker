import test from 'node:test';
import assert from 'node:assert/strict';
import { User, TravelDocument, TravelHistory, Notification, DestinationRequirement, SupportQuery, AuditLog } from '../src/models/index.js';

const id = () => '507f1f77bcf86cd799439011';

test('user normalizes email, applies defaults, and hides its password hash', async () => {
  const user = new User({ name: 'Traveler', email: '  TRAVELER@example.com ', passwordHash: 'hashed-value-that-is-long-enough' });
  await user.validate();
  assert.equal(user.email, 'traveler@example.com');
  assert.equal(user.role, 'traveler');
  assert.equal(user.accountStatus, 'pending');
  assert.equal(User.schema.path('passwordHash').options.select, false);
  assert.ok(User.schema.indexes().some(([keys, options]) => keys.email === 1 && options.unique));
});

test('user rejects unsupported roles and malformed email addresses', async () => {
  const user = new User({ name: 'Traveler', email: 'bad-email', passwordHash: 'hashed-value-that-is-long-enough', role: 'root' });
  await assert.rejects(user.validate(), (error) => Boolean(error.errors.role && error.errors.email));
});

test('travel document validates required private storage reference and date order', async () => {
  const document = new TravelDocument({ owner: id(), documentType: 'passport', displayName: 'Passport', issuingCountry: 'in', issueDate: '2025-01-01', expiryDate: '2024-01-01', file: { objectKey: 'private/user/file-id' } });
  await assert.rejects(document.validate(), /Expiry date must be on or after issue date/);
  assert.equal(TravelDocument.schema.path('file.objectKey').options.select, false);
  assert.ok(TravelDocument.schema.indexes().some(([keys]) => keys.owner === 1 && keys.expiryDate === 1));
});

test('travel documents support multiple optional private attachments in the existing collection', async () => {
  const document = new TravelDocument({ owner: id(), documentType: 'vaccination_certificate', displayName: 'Vaccination record', issuingCountry: 'IN', expiryDate: '2030-01-01', files: [{ storageProvider: 'private_local', objectKey: '3b241101-e2bb-4255-8caf-4136c566a962.pdf', originalName: 'certificate.pdf', metadata: { mimeType: 'application/pdf', sizeBytes: 12, checksumSha256: 'a'.repeat(64) } }] });
  await document.validate();
  assert.equal(TravelDocument.collection.collectionName, 'traveldocuments');
  assert.equal(TravelDocument.schema.path('files.0.objectKey').options.select, false);
  assert.equal(document.files.length, 1);
  assert.equal(TravelDocument.schema.path('file.objectKey').options.required, undefined);
});

test('travel history requires supported purpose and return date follows departure', async () => {
  const history = new TravelHistory({ owner: id(), destinationCountry: 'US', purpose: 'vacation', departureDate: '2026-06-10', returnDate: '2026-06-01' });
  await assert.rejects(history.validate(), (error) => Boolean(error.errors.purpose && error.errors.returnDate));
});

test('notifications have unique deduplication index and never define passport number', async () => {
  const notification = new Notification({ owner: id(), type: 'expiry_reminder', scheduledAt: new Date(), idempotencyKey: 'expiry:user:document:30d' });
  await notification.validate();
  assert.ok(Notification.schema.indexes().some(([keys, options]) => keys.idempotencyKey === 1 && options.unique));
  assert.equal(Notification.schema.path('passportNumber'), undefined);
  assert.equal(Notification.schema.path('relatedDocument').options.ref, 'TravelDocument');
});

test('destination source must use HTTPS and requirement type must be valid', async () => {
  const item = new DestinationRequirement({ destinationCountry: 'GB', nationality: 'IN', title: 'Visa', description: 'Check visa rules.', requirementType: 'required', officialSourceUrl: 'http://example.gov', lastUpdatedBy: id() });
  await assert.rejects(item.validate(), /valid HTTPS official source URL/);
});

test('destination requirement verification date cannot be in the future', async () => {
  const item = new DestinationRequirement({ destinationCountry: 'GB', nationality: 'IN', purpose: 'tourism', title: 'Entry information', description: 'Review the official information.', requirementType: 'informational', officialSourceUrl: 'https://example.gov/entry', lastVerifiedAt: new Date('2999-01-01'), lastUpdatedBy: id() });
  await assert.rejects(item.validate(), /Last verified date cannot be in the future/);
});

test('support query has a bounded, valid status field', async () => {
  const query = new SupportQuery({ subject: 'Help with account', message: 'Please help me with my account.', status: 'ignored' });
  await assert.rejects(query.validate(), (error) => Boolean(error.errors.status));
});

test('audit metadata rejects keys that could contain personal or document data', async () => {
  const log = new AuditLog({ actor: id(), action: 'document.viewed', resourceType: 'travel_document', resourceId: id(), metadata: { result: 'success', changedFields: ['password'] } });
  await assert.rejects(log.validate(), /allow-listed field names/);
  const unsafe = new AuditLog({ actor: id(), action: 'document.viewed', resourceType: 'travel_document', metadata: { values: { email: 'person@example.com' } } });
  await assert.rejects(unsafe.validate());
  assert.ok(AuditLog.schema.indexes().some(([keys]) => keys.resourceType === 1 && keys.resourceId === 1));
});

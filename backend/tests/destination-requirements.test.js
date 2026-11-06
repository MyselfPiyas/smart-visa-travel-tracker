import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import errorHandler from '../src/middleware/error-handler.js';
import { createAdminRouter, createTravelerRouter } from '../src/routes/protected.routes.js';
import { createAdminDestinationRouter, createTravelerDestinationRouter } from '../src/routes/destination-requirements.routes.js';
import { createDestinationChecklistService } from '../src/services/destination-checklist.service.js';

const owner = '507f1f77bcf86cd799439011';
const admin = '507f1f77bcf86cd799439012';
const fixedNow = new Date('2026-11-04T12:00:00.000Z');
const id = (n) => `507f1f77bcf86cd7994390${String(n).padStart(2,'0')}`;
const requirements = [
  { _id: id(21), destinationCountry: 'JP', nationality: 'IN', purpose: 'any', title: 'Passport validity', description: 'Review passport validity dates for your planned trip.', requirementType: 'required', officialSourceUrl: 'https://www.example.gov/passport', lastVerifiedAt: new Date('2026-01-01'), active: true, lastUpdatedBy: admin, updatedAt: fixedNow },
  { _id: id(22), destinationCountry: 'JP', nationality: 'IN', purpose: 'tourism', title: 'Visa information', description: 'Review visa information with the authority.', requirementType: 'conditional', officialSourceUrl: 'https://www.example.gov/visa', lastVerifiedAt: new Date('2026-10-01'), active: true, lastUpdatedBy: admin, updatedAt: fixedNow },
  { _id: id(23), destinationCountry: 'JP', nationality: 'IN', purpose: 'tourism', title: 'Accommodation evidence', description: 'Review accommodation information.', requirementType: 'informational', officialSourceUrl: 'https://www.example.gov/accommodation', lastVerifiedAt: null, active: true, lastUpdatedBy: admin, updatedAt: fixedNow },
  { _id: id(26), destinationCountry: 'JP', nationality: 'IN', purpose: 'tourism', title: 'Travel insurance', description: 'Review insurance information.', requirementType: 'conditional', officialSourceUrl: 'https://www.example.gov/insurance', lastVerifiedAt: fixedNow, active: true, lastUpdatedBy: admin, updatedAt: fixedNow },
  { _id: id(24), destinationCountry: 'JP', nationality: 'IN', purpose: 'tourism', title: 'Inactive entry', description: 'Should not appear.', requirementType: 'required', officialSourceUrl: 'https://www.example.gov/inactive', lastVerifiedAt: fixedNow, active: false, lastUpdatedBy: admin, updatedAt: fixedNow },
  { _id: id(25), destinationCountry: 'JP', nationality: 'CA', purpose: 'tourism', title: 'Canadian route', description: 'Different nationality.', requirementType: 'required', officialSourceUrl: 'https://www.example.gov/ca', lastVerifiedAt: fixedNow, active: true, lastUpdatedBy: admin, updatedAt: fixedNow },
];
const documents = [
  { _id: id(31), owner, status: 'valid', documentType: 'passport', displayName: 'Main passport', expiryDate: new Date('2030-01-01') },
  { _id: id(32), owner, status: 'valid', documentType: 'visa', displayName: 'Japan visa', issuingCountry: 'JP', validFrom: new Date('2026-01-01'), expiryDate: new Date('2027-01-01'), visaEntryType: 'single_entry' },
  { _id: id(33), owner: admin, status: 'valid', documentType: 'travel_insurance', displayName: 'Admin insurance', expiryDate: new Date('2030-01-01') },
];
function matches(row, filter) { return Object.entries(filter).every(([key, expected]) => {
  if (key === '$or') return expected.some((branch) => matches(row, branch));
  const actual = row[key];
  if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
    if ('$in' in expected) return expected.$in.includes(actual);
    if ('$regex' in expected) return new RegExp(expected.$regex, expected.$options).test(actual || '');
    if ('$ne' in expected && actual === expected.$ne) return false;
    return true;
  }
  return String(actual) === String(expected);
}); }
function query(rows, filter) { let offset = 0; let max = Infinity; let sortSpec;
  const q = { sort(value) { sortSpec = value; return q; }, skip(value) { offset = value; return q; }, limit(value) { max = value; return q; }, select() { return q; }, lean: async () => { const found = rows.filter((row) => matches(row, filter)); if (sortSpec) { const [key, direction] = Object.entries(sortSpec)[0]; found.sort((a,b) => String(a[key]).localeCompare(String(b[key])) * direction); } return found.slice(offset, offset + max); } }; return q; }
function makeModels() {
  const audit = [];
  const RequirementModel = {
    find: (filter) => query(requirements, filter), countDocuments: async (filter) => requirements.filter((row) => matches(row, filter)).length,
    async create(values) { const item = { ...values, _id: id(90), updatedAt: fixedNow }; requirements.push(item); return item; },
    async findById(value) { const item = requirements.find((row) => String(row._id) === String(value)); if (!item) return null; return { ...item, async save() { const target = requirements.find((row) => String(row._id) === String(this._id)); Object.assign(target, this); } }; },
    async findByIdAndDelete(value) { const index = requirements.findIndex((row) => String(row._id) === String(value)); return index < 0 ? null : requirements.splice(index, 1)[0]; },
  };
  const DocumentModel = {
    find(filter) { const selected = documents.filter((row) => matches(row, filter)); return { select() { return this; }, lean: async () => selected }; },
  };
  const AuditLogModel = { async create(item) { audit.push({ ...item, _id: id(audit.length + 60) }); }, find: (filter) => query(audit, filter) };
  return { RequirementModel, DocumentModel, AuditLogModel, audit };
}
function apps(models) {
  const service = createDestinationChecklistService({ RequirementModel: models.RequirementModel, DocumentModel: models.DocumentModel, now: () => fixedNow, staleDays: () => 180 });
  const auth = (req, _res, next) => { req.user = { id: req.header('x-role') === 'admin' ? admin : owner, role: req.header('x-role') || 'traveler' }; next(); };
  const app = express(); app.use(express.json());
  app.use('/api/traveler', createTravelerRouter({ authenticateMiddleware: auth, destinationRouter: createTravelerDestinationRouter({ ...models, service }) }));
  app.use('/api/admin', createAdminRouter({ authenticateMiddleware: auth, destinationRouter: createAdminDestinationRouter({ ...models, now: () => fixedNow }) }));
  app.use(errorHandler); return app;
}

test('traveler checklist filters active records by destination, nationality, and purpose', async () => {
  const models = makeModels(); const app = apps(models);
  const response = await request(app).get('/api/traveler/destinations/checklist?destinationCountry=JP&nationality=IN&purpose=tourism&departureDate=2026-12-01&returnDate=2026-12-10').expect(200);
  assert.equal(response.body.requirements.length, 4);
  assert.equal(response.body.requirements.some((item) => item.title === 'Inactive entry'), false);
  assert.equal(response.body.requirements.some((item) => item.title === 'Canadian route'), false);
  assert.equal(response.body.requirements.find((item) => item.title === 'Passport validity').matchStatus, 'potential_match');
  assert.equal(response.body.requirements.find((item) => item.title === 'Visa information').matchStatus, 'potential_match');
  assert.equal(response.body.requirements.find((item) => item.title === 'Accommodation evidence').matchStatus, 'uncertain');
  assert.equal(response.body.requirements.find((item) => item.title === 'Travel insurance').matchStatus, 'missing');
  assert.equal(response.body.requirements.find((item) => item.title === 'Passport validity').verificationStatus, 'outdated');
  assert.equal(response.body.requirements[0].officialSourceUrl.startsWith('https://'), true);
  assert.equal(JSON.stringify(response.body).includes('Admin insurance'), false);
});

test('traveler search is paginated, active-only, and empty results are clear', async () => {
  const app = apps(makeModels());
  const found = await request(app).get('/api/traveler/destinations?q=JP&nationality=IN&purpose=tourism&page=1&limit=2').expect(200);
  assert.equal(found.body.pagination.total, 4);
  assert.equal(found.body.items.length, 2);
  const empty = await request(app).get('/api/traveler/destinations?destinationCountry=US&nationality=IN').expect(200);
  assert.deepEqual(empty.body.items, []);
});

test('traveler cannot write official requirements; admin CRUD records safe audit events', async () => {
  const models = makeModels(); const app = apps(models);
  await request(app).post('/api/admin/destinations').set('x-role', 'traveler').send({}).expect(403);
  await request(app).post('/api/admin/destinations').set('x-role', 'admin').send({ destinationCountry: 'JP', nationality: 'IN', purpose: 'tourism', title: 'Insurance', description: 'Review insurance information.', requirementType: 'informational', officialSourceUrl: 'https://www.example.gov/insurance', lastVerifiedAt: '2026-11-01' }).expect(201);
  assert.equal(models.audit[0].actor, admin);
  assert.equal(models.audit[0].action, 'destination_requirement.created');
  await request(app).patch(`/api/admin/destinations/${id(90)}`).set('x-role', 'admin').send({ officialSourceUrl: 'http://example.gov' }).expect(400);
  await request(app).patch(`/api/admin/destinations/${id(90)}/deactivate`).set('x-role', 'admin').expect(200);
  assert.equal(models.audit.some((row) => row.action === 'destination_requirement.deactivated'), true);
  await request(app).delete(`/api/admin/destinations/${id(90)}`).set('x-role', 'admin').expect(200);
  const history = await request(app).get('/api/admin/destinations/history').set('x-role', 'admin').expect(200);
  assert.ok(history.body.items.length >= 3);
});

test('checklist validates calendar dates and flags documents that expire before the trip', async () => {
  const models = makeModels();
  models.RequirementModel.find = (filter) => query(requirements.filter((item) => item.title === 'Passport validity'), filter);
  models.DocumentModel.find = (filter) => { const rows = [{ _id: id(34), owner, status: 'valid', documentType: 'passport', displayName: 'Short passport', expiryDate: new Date('2026-12-05') }]; return { select() { return this; }, lean: async () => rows.filter((row) => matches(row, filter)) }; };
  const app = apps(models);
  await request(app).get('/api/traveler/destinations/checklist?destinationCountry=JP&nationality=IN&purpose=tourism&departureDate=2026-02-31&returnDate=2026-03-10').expect(400);
  const result = await request(app).get('/api/traveler/destinations/checklist?destinationCountry=JP&nationality=IN&purpose=tourism&departureDate=2026-12-01&returnDate=2026-12-10').expect(200);
  assert.equal(result.body.requirements[0].matchStatus, 'potentially_expired');
});

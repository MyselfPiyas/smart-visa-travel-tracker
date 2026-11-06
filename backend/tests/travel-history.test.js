import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import errorHandler from '../src/middleware/error-handler.js';
import { createTravelHistoryRouter } from '../src/routes/travel-history.routes.js';

const owner = '507f1f77bcf86cd799439011';
const other = '507f1f77bcf86cd799439012';
const visaId = '507f1f77bcf86cd799439013';
const fixedNow = new Date('2027-01-01T12:00:00.000Z');

function matches(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const value = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof RegExp)) {
      if ('$in' in expected) return expected.$in.some((id) => String(id) === String(value));
      if ('$regex' in expected) return new RegExp(expected.$regex, expected.$options).test(value || '');
      if ('$gte' in expected && !(value >= expected.$gte)) return false;
      if ('$lte' in expected && !(value <= expected.$lte)) return false;
      if ('$lt' in expected && !(value < expected.$lt)) return false;
      return true;
    }
    return String(value) === String(expected);
  });
}

function fixture() {
  const rows = [
    { _id: '507f1f77bcf86cd799439021', owner, destinationCountry: 'JP', purpose: 'tourism', departureDate: new Date('2026-04-01'), returnDate: new Date('2026-04-10'), actualEntryDate: new Date('2026-04-01'), actualExitDate: new Date('2026-04-09'), visaDocument: visaId, relatedDocuments: [], notes: 'Conference trip', createdAt: fixedNow, updatedAt: fixedNow },
    { _id: '507f1f77bcf86cd799439022', owner, destinationCountry: 'FR', purpose: 'business', departureDate: new Date('2026-05-01'), returnDate: new Date('2026-05-10'), relatedDocuments: [], createdAt: fixedNow, updatedAt: fixedNow },
    { _id: '507f1f77bcf86cd799439023', owner: other, destinationCountry: 'US', purpose: 'education', departureDate: new Date('2026-06-01'), relatedDocuments: [], createdAt: fixedNow, updatedAt: fixedNow },
  ];
  const visa = { _id: visaId, owner, documentType: 'visa', displayName: 'Japan visa', validFrom: new Date('2026-01-01'), expiryDate: new Date('2027-01-01'), visaEntryType: 'single_entry', allowedStayDays: 90 };
  const DocumentModel = {
    findOne: (filter) => ({ select() { return this; }, lean: async () => String(filter._id) === visaId && String(filter.owner) === owner && filter.documentType === 'visa' ? { _id: visaId } : null }),
    find: (filter) => ({ select() { return this; }, lean: async () => filter._id?.$in?.filter((id) => String(id) === visaId).map(() => ({ _id: visaId })) || [] }),
  };
  const populateRecord = (row) => ({ ...row, visaDocument: String(row.visaDocument) === visaId ? visa : null, relatedDocuments: [] });
  const TravelHistoryModel = {
    async create(values) { const row = { ...values, _id: '507f1f77bcf86cd799439099', createdAt: fixedNow, updatedAt: fixedNow }; rows.push(row); return row; },
    find(filter) {
      let sortSpec = null; let offset = 0; let max = Infinity;
      const q = { sort(value) { sortSpec = value; return q; }, skip(value) { offset = value; return q; }, limit(value) { max = value; return q; }, populate() { return q; }, lean: async () => {
        let result = rows.filter((row) => matches(row, filter));
        if (sortSpec) { const [key, direction] = Object.entries(sortSpec)[0]; result.sort((a,b) => (a[key] - b[key]) * direction); }
        return result.slice(offset, offset + max).map(populateRecord);
      } };
      return q;
    },
    countDocuments: async (filter) => rows.filter((row) => matches(row, filter)).length,
    findOne(filter) {
      const item = rows.find((row) => matches(row, filter));
      const q = { select() { return q; }, populate() { return q; }, lean: async () => item ? populateRecord(item) : null,
        then(resolve, reject) {
          if (!item) return Promise.resolve(null).then(resolve, reject);
          const doc = { ...item, toObject: () => ({ ...item }), async save() { Object.assign(item, Object.fromEntries(Object.entries(this).filter(([key]) => !['toObject','save'].includes(key)))); item.updatedAt = fixedNow; } };
          return Promise.resolve(doc).then(resolve, reject);
        } };
      return q;
    },
    findOneAndDelete(filter) { const index = rows.findIndex((row) => matches(row, filter)); return Promise.resolve(index < 0 ? null : rows.splice(index, 1)[0]); },
  };
  const app = express(); app.use(express.json()); app.use('/api/traveler/travel-history', (req, _res, next) => { req.user = { id: owner, role: 'traveler' }; next(); }, createTravelHistoryRouter({ TravelHistoryModel, DocumentModel, AuditLogModel: { create: async () => {} }, now: () => fixedNow })); app.use(errorHandler);
  return { app, rows };
}

test('travel history lists owner-only records, filters by country and purpose, and paginates', async () => {
  const { app } = fixture();
  const result = await request(app).get('/api/traveler/travel-history?country=j&purpose=tourism&page=1&limit=1').expect(200);
  assert.equal(result.body.records.length, 1);
  assert.equal(result.body.records[0].destinationCountry, 'JP');
  assert.equal(result.body.pagination.total, 1);
  assert.equal(result.body.records[0].visaDocument.displayName, 'Japan visa');
  await request(app).get('/api/traveler/travel-history?limit=1').expect(200).expect((response) => assert.equal(response.body.records.length, 1));
});

test('travelers create, update, view, and delete a record with date validation', async () => {
  const { app, rows } = fixture();
  const created = await request(app).post('/api/traveler/travel-history').send({ destinationCountry: 'in', purpose: 'medical', departureDate: '2027-02-01', returnDate: '2027-02-10', actualEntryDate: '2027-02-02', actualExitDate: '2027-02-09', visaDocument: visaId, relatedDocuments: [visaId] }).expect(201);
  const id = created.body.record.id;
  assert.equal(created.body.record.destinationCountry, 'IN');
  await request(app).get(`/api/traveler/travel-history/${id}`).expect(200);
  await request(app).patch(`/api/traveler/travel-history/${id}`).send({ notes: 'Updated note', returnDate: '2027-02-12' }).expect(200).expect((response) => assert.equal(response.body.record.notes, 'Updated note'));
  await request(app).delete(`/api/traveler/travel-history/${id}`).expect(200);
  assert.equal(rows.some((row) => row._id === id), false);
  await request(app).post('/api/traveler/travel-history').send({ destinationCountry: 'IN', purpose: 'tourism', departureDate: '2027-02-10', returnDate: '2027-02-01' }).expect(400);
  await request(app).post('/api/traveler/travel-history').send({ destinationCountry: 'IN', purpose: 'tourism', departureDate: '2027-02-31' }).expect(400);
});

test('cross-owner details are not found and unrelated document references are rejected', async () => {
  const { app } = fixture();
  await request(app).get('/api/traveler/travel-history/507f1f77bcf86cd799439023').expect(404);
  await request(app).post('/api/traveler/travel-history').send({ destinationCountry: 'IN', purpose: 'tourism', departureDate: '2027-01-10', visaDocument: '507f1f77bcf86cd799439099' }).expect(400);
});

test('empty travel history returns an empty paginated response', async () => {
  const { app, rows } = fixture(); rows.splice(0, rows.length);
  const result = await request(app).get('/api/traveler/travel-history').expect(200);
  assert.deepEqual(result.body.records, []);
  assert.equal(result.body.pagination.total, 0);
});

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDocumentRouter, validateDocumentPayload } from '../src/routes/documents.routes.js';
import { createDocumentUploadMiddleware, createLocalDocumentStorage } from '../src/services/local-document-storage.js';
import { getDocumentStatus } from '../src/utils/document-status.js';
import csrfProtection, { issueCsrfToken } from '../src/middleware/csrf.js';
import errorHandler from '../src/middleware/error-handler.js';

const ownerA = '507f1f77bcf86cd799439011';
const ownerB = '507f1f77bcf86cd799439012';
const fixedNow = new Date('2026-03-15T12:00:00.000Z');
const currentDirs = new Set();
afterEach(async () => { await Promise.all([...currentDirs].map((dir) => rm(dir, { recursive: true, force: true }))); currentDirs.clear(); });

function matches(row, filter) {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$or') { if (!expected.some((branch) => matches(row, branch))) return false; continue; }
    if ((key === 'owner' || key === '_id') && String(row[key]) !== String(expected)) return false;
    if (key === 'status' && expected?.$ne && row.status === expected.$ne) return false;
    if (key === 'displayName' && expected?.$regex && !new RegExp(expected.$regex, expected.$options).test(row.displayName)) return false;
    if (key === 'expiryDate' && expected && typeof expected === 'object') {
      if (expected.$lt && !(row.expiryDate && row.expiryDate < expected.$lt)) return false;
      if (expected.$gte && !(row.expiryDate && row.expiryDate >= expected.$gte)) return false;
    }
    if (!['$or', 'owner', '_id', 'status', 'expiryDate', 'displayName'].includes(key) && row[key] !== expected) return false;
  }
  return true;
}

function createDocumentModel() {
  const records = new Map();
  function makeDocument(data) {
    const doc = { ...data, _id: data._id || new mongoose.Types.ObjectId(), files: data.files || [], createdAt: data.createdAt || fixedNow, updatedAt: fixedNow };
    doc.toObject = () => ({ ...doc, toObject: undefined });
    doc.save = async () => { doc.updatedAt = fixedNow; for (const file of doc.files) file._id ||= new mongoose.Types.ObjectId(); records.set(String(doc._id), doc); return doc; };
    return doc;
  }
  function query(value) {
    return {
      sort(spec) { this.sortSpec = spec; return this; }, skip(count) { this.skipCount = count; return this; }, limit(count) { this.limitCount = count; return this; }, select() { return this; },
      async lean() { return resolveValue(value, this); }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
  }
  async function resolveValue(value, opts = {}) {
    const rows = await Promise.resolve(value);
    if (!Array.isArray(rows)) return rows;
    const spec = opts.sortSpec || {};
    const [field, direction] = Object.entries(spec)[0] || [];
    const sorted = [...rows].sort((a, b) => {
      const left = a[field] == null ? (direction === 1 ? Infinity : -Infinity) : new Date(a[field]).valueOf();
      const right = b[field] == null ? (direction === 1 ? Infinity : -Infinity) : new Date(b[field]).valueOf();
      return (left - right) * direction;
    });
    return sorted.slice(opts.skipCount || 0, (opts.skipCount || 0) + (opts.limitCount || sorted.length)).map((row) => ({ ...row, toObject: undefined }));
  }
  return {
    records,
    async create(data) { const row = makeDocument(data); records.set(String(row._id), row); return row; },
    find(filter) { return query([...records.values()].filter((row) => matches(row, filter))); },
    countDocuments(filter) { return Promise.resolve([...records.values()].filter((row) => matches(row, filter)).length); },
    findOne(filter) { return query([...records.values()].find((row) => matches(row, filter)) || null); },
    async deleteOne(filter) { const item = [...records.values()].find((row) => matches(row, filter)); if (item) records.delete(String(item._id)); return { deletedCount: Number(Boolean(item)) }; },
  };
}

async function createHarness({ maxFileSizeBytes = 1024 * 1024, maxFiles = 5 } = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'smart-visa-docs-'));
  currentDirs.add(rootDir);
  const storage = createLocalDocumentStorage({ rootDir, maxFiles });
  const upload = createDocumentUploadMiddleware({ storage, maxFileSizeBytes, maxFiles });
  const DocumentModel = createDocumentModel();
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.get('/api/auth/csrf', issueCsrfToken); app.use('/api', csrfProtection);
  app.use('/api/traveler/documents', (req, res, next) => {
    if (req.header('x-test-user') !== 'traveler') return res.status(401).json({ error: { message: 'Please sign in to continue.' } });
    req.user = { id: req.header('x-owner') || ownerA, role: req.header('x-test-role') || 'traveler' };
    return next();
  }, (req, res, next) => req.user.role === 'traveler' ? next() : res.status(403).json({ error: { message: 'You do not have access to this area.' } }), createDocumentRouter({ DocumentModel, storage, upload, AuditLogModel: { create: async () => {} }, now: () => fixedNow }));
  app.use(errorHandler);
  const agent = request.agent(app);
  const csrfResponse = await agent.get('/api/auth/csrf').expect(200);
  const csrfCookie = csrfResponse.headers['set-cookie'].find((cookie) => cookie.startsWith('csrf_token=')).split(';')[0];
  const auth = (owner = ownerA, role = 'traveler') => ({ 'x-test-user': 'traveler', 'x-owner': owner, 'x-test-role': role });
  const mutation = (req, owner = ownerA) => req.set(auth(owner)).set('Cookie', csrfCookie).set('X-CSRF-Token', csrfResponse.body.csrfToken);
  return { agent, auth, mutation, DocumentModel, storage, rootDir };
}

const documentBody = { documentType: 'passport', displayName: 'Main passport', issuingCountry: 'IN', issueDate: '2020-01-01', expiryDate: '2030-01-01' };

test('validates supported document fields, dates, and type values', () => {
  assert.deepEqual(validateDocumentPayload(documentBody), { ...documentBody, issuingCountry: 'IN', issueDate: new Date('2020-01-01T00:00:00.000Z'), expiryDate: new Date('2030-01-01T00:00:00.000Z') });
  assert.throws(() => validateDocumentPayload({ ...documentBody, documentType: 'bank_card' }), /supported document type/);
  assert.throws(() => validateDocumentPayload({ ...documentBody, issueDate: '2026-02-30' }), /valid calendar date/);
  assert.throws(() => validateDocumentPayload({ ...documentBody, issueDate: '2026-03-01', expiryDate: '2026-02-28' }), /on or after issue date/);
  assert.throws(() => validateDocumentPayload({ ...documentBody, passportNumber: 'must-not-be-accepted' }), /unsupported document field/);
  assert.throws(() => validateDocumentPayload({ ...documentBody, documentType: { $ne: 'passport' } }), /supported document type/);
});

test('central document status uses UTC day boundaries and marks missing information', () => {
  assert.equal(getDocumentStatus({ issuingCountry: 'IN', expiryDate: new Date('2026-03-14T23:59:00Z') }, fixedNow), 'expired');
  assert.equal(getDocumentStatus({ issuingCountry: 'IN', expiryDate: new Date('2026-06-13T22:00:00Z') }, fixedNow), 'expiring_soon');
  assert.equal(getDocumentStatus({ issuingCountry: 'IN', expiryDate: new Date('2026-06-14T00:00:00Z') }, fixedNow), 'valid');
  assert.equal(getDocumentStatus({ issuingCountry: null, expiryDate: null }, fixedNow), 'pending_information');
});

test('create, list, filter, paginate, update, and isolate documents by owner', async () => {
  const h = await createHarness();
  const create = await h.mutation(h.agent.post('/api/traveler/documents')).send(documentBody).expect(201);
  const id = create.body.document.id;
  assert.equal(create.body.document.status, 'valid');
  assert.equal(create.body.document.files.length, 0);
  await h.agent.get(`/api/traveler/documents/${id}/status`).set(h.auth()).expect(200).then((response) => {
    assert.equal(response.body.statusDetails.status, 'valid');
    assert.equal(response.body.statusDetails.remainingDays, 1388);
  });
  await h.agent.get(`/api/traveler/documents/${id}/status`).set(h.auth(ownerB)).expect(404);
  await h.mutation(h.agent.post(`/api/traveler/documents/${id}/recalculate-status`)).expect(200).then((response) => assert.equal(response.body.statusDetails.status, 'valid'));
  const visa = await h.mutation(h.agent.post('/api/traveler/documents')).send({ ...documentBody, documentType: 'visa', validFrom: '2026-04-01', visaEntryType: 'single_entry', allowedStayDays: 60 }).expect(201);
  assert.equal(visa.body.document.status, 'not_yet_valid');
  assert.equal(visa.body.document.visaEntryType, 'single_entry');
  await h.mutation(h.agent.patch(`/api/traveler/documents/${visa.body.document.id}`)).send({ validFrom: '2026-04-02' }).expect(200).then((response) => assert.equal(response.body.document.validFrom, '2026-04-02T00:00:00.000Z'));
  await h.mutation(h.agent.post('/api/traveler/documents')).send({ ...documentBody, documentType: 'invalid' }).expect(400);
  await h.mutation(h.agent.patch(`/api/traveler/documents/${id}`)).send({ displayName: 'Updated passport' }).expect(200).then((response) => assert.equal(response.body.document.displayName, 'Updated passport'));
  await h.agent.get(`/api/traveler/documents/${id}`).set(h.auth(ownerB)).expect(404);
  await h.agent.get('/api/traveler/documents').set(h.auth(ownerB)).expect(200).then((response) => assert.equal(response.body.pagination.total, 0));
  await h.mutation(h.agent.post('/api/traveler/documents')).send({ ...documentBody, displayName: 'Student visa', documentType: 'visa' }).expect(201);
  await h.mutation(h.agent.post('/api/traveler/documents')).send({ ...documentBody, displayName: 'Old UK visa', documentType: 'visa', issuingCountry: 'GB', expiryDate: '2026-03-10' }).expect(201);
  await h.agent.get('/api/traveler/documents?documentType=visa&page=1&limit=1').set(h.auth()).expect(200).then((response) => {
    assert.equal(response.body.items.length, 1); assert.equal(response.body.pagination.total, 3); assert.equal(response.body.pagination.pages, 3); assert.equal(response.body.items[0].documentType, 'visa');
  });
  await h.agent.get('/api/traveler/documents?issuingCountry=GB&expiryStatus=expired').set(h.auth()).expect(200).then((response) => assert.equal(response.body.items[0].displayName, 'Old UK visa'));
  await h.agent.get('/api/traveler/documents?q=passport').set(h.auth()).expect(200).then((response) => assert.equal(response.body.items[0].displayName, 'Updated passport'));
  await h.agent.get('/api/traveler/documents?documentType=unknown').set(h.auth()).expect(400);
  await h.agent.get('/api/traveler/documents').set(h.auth(ownerA, 'admin')).expect(403);
});

test('uploads validate extension, MIME, signature, and file size; authorized owners can download only their own files', async () => {
  const h = await createHarness({ maxFileSizeBytes: 1024, maxFiles: 2 });
  const id = (await h.mutation(h.agent.post('/api/traveler/documents')).send(documentBody).expect(201)).body.document.id;
  const pdf = Buffer.from('%PDF-1.4\nSafe test fixture\n');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const upload = await h.mutation(h.agent.post(`/api/traveler/documents/${id}/files`)).attach('files', pdf, { filename: '../../passport.pdf', contentType: 'application/pdf' }).attach('files', png, { filename: 'support.png', contentType: 'image/png' }).expect(201);
  assert.equal(upload.body.document.files.length, 2);
  const file = upload.body.document.files[0];
  assert.equal(file.name, 'Attachment 1.pdf');
  assert.equal(file.mimeType, 'application/pdf');
  assert.equal(file.objectKey, undefined);
  await h.agent.get(`/api/traveler/documents/${id}/files/${file.id}`).set(h.auth()).expect(200).expect('Content-Type', /application\/pdf/).expect('Cache-Control', /no-store/).then((response) => assert.deepEqual(response.body, pdf));
  await h.agent.get(`/api/traveler/documents/${id}/files/${file.id}`).set(h.auth(ownerB)).expect(404);
  await h.mutation(h.agent.post(`/api/traveler/documents/${id}/files`)).attach('files', Buffer.from('not really a pdf'), { filename: 'fake.pdf', contentType: 'application/pdf' }).expect(400);
  await h.mutation(h.agent.post(`/api/traveler/documents/${id}/files`)).attach('files', pdf, { filename: 'wrong.txt', contentType: 'text/plain' }).expect(400);
  await h.mutation(h.agent.post(`/api/traveler/documents/${id}/files`)).attach('files', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(1100)]), { filename: 'too-big.pdf', contentType: 'application/pdf' }).expect(413);
  const storedFiles = await readdir(h.rootDir);
  assert.equal(storedFiles.length, 2);
  await h.mutation(h.agent.delete(`/api/traveler/documents/${id}`)).expect(204);
  assert.deepEqual(await readdir(h.rootDir), []);
  await h.agent.get(`/api/traveler/documents/${id}`).set(h.auth()).expect(404);
});

test('document endpoints require traveler authorization and mutations require CSRF', async () => {
  const h = await createHarness();
  await h.agent.get('/api/traveler/documents').expect(401);
  await h.agent.get('/api/traveler/documents').set(h.auth(ownerA, 'admin')).expect(403);
  await h.agent.post('/api/traveler/documents').set(h.auth()).send(documentBody).expect(403);
});

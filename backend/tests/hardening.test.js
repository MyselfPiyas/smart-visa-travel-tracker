import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { validateEnvironment } from '../src/config/environment.js';
import errorHandler from '../src/middleware/error-handler.js';
import { createProfileRouter } from '../src/routes/profile.routes.js';

test('API sets security headers, hides Express identity, and rejects unapproved CORS origins safely', async () => {
  const allowed = await request(app).get('/').set('Origin', 'http://localhost:5173').expect(200);
  assert.match(allowed.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(allowed.headers['x-powered-by'], undefined);
  const denied = await request(app).get('/').set('Origin', 'https://attacker.example').expect(403);
  assert.equal(denied.body.error.message, 'Origin is not allowed by CORS.');
  assert.equal(JSON.stringify(denied.body).includes('stack'), false);
});

test('production startup rejects weak secrets, non-HTTPS browser origins, and invalid rate limits', () => {
  assert.throws(() => validateEnvironment({ NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', JWT_SECRET: 'short', MONGODB_URI: 'mongodb://localhost/test' }), /JWT_SECRET/);
  assert.throws(() => validateEnvironment({ NODE_ENV: 'production', FRONTEND_ORIGIN: 'http://app.example.com', JWT_SECRET: 'a'.repeat(48), MONGODB_URI: 'mongodb://localhost/test' }), /HTTPS/);
  assert.throws(() => validateEnvironment({ NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173', AUTH_RATE_LIMIT: '-1' }), /AUTH_RATE_LIMIT/);
});

test('password changes are rate-limited and error responses do not reveal server details', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', passwordHash: await bcrypt.hash('the-correct-password', 4), save: async () => {} };
  const UserModel = { findById: () => ({ select() { return this; }, then(resolve) { return Promise.resolve(user).then(resolve); } }) };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { id: user._id, role: 'traveler' }; next(); }); app.use('/profile', createProfileRouter({ UserModel, AuditLogModel: { create: async () => {} } }));
  app.get('/explode', () => { throw new Error('private internal detail'); }); app.use(errorHandler);
  let response;
  for (let i = 0; i < 5; i += 1) response = await request(app).post('/profile/password').send({ currentPassword: 'incorrect-password', newPassword: 'a-new-strong-password' });
  assert.equal(response.status, 400);
  response = await request(app).post('/profile/password').send({ currentPassword: 'incorrect-password', newPassword: 'a-new-strong-password' }).expect(429);
  assert.match(response.body.error.message, /Too many password attempts/);
  const failed = await request(app).get('/explode').expect(500);
  assert.equal(failed.body.error.message, 'An unexpected server error occurred');
  assert.equal(JSON.stringify(failed.body).includes('private internal detail'), false);
});

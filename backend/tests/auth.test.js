import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import csrfProtection from '../src/middleware/csrf.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';
import { authorize } from '../src/middleware/authorize.js';
import { getAuthSettings } from '../src/config/auth.js';

const secret = randomBytes(48).toString('hex');
const createUserStore = () => {
  const records = new Map();
  let nextId = 1;
  return {
    records,
    async create(values) {
      if (records.has(values.email)) { const error = new Error('duplicate'); error.code = 11000; throw error; }
      const user = { ...values, _id: String(nextId++), createdAt: new Date(), async save() {} };
      records.set(user.email, user);
      return user;
    },
    findOne(filter) {
      const query = { select() { return query; }, then(resolve, reject) { return Promise.resolve(records.get(filter.email) || null).then(resolve, reject); } };
      return query;
    },
    async findById(id) { return [...records.values()].find((user) => user._id === String(id)) || null; },
  };
};

function buildApp(UserModel, audit = []) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', csrfProtection);
  app.use('/api/auth', createAuthRouter({ UserModel, AuditLogModel: { create: async (event) => audit.push(event) }, secretProvider: () => secret, limiter: (_req, _res, next) => next() }));
  const authenticate = createAuthenticate({ UserModel, secret });
  app.get('/api/traveler', authenticate, authorize('traveler'), (req, res) => res.json({ role: req.user.role }));
  app.get('/api/admin', authenticate, authorize('admin'), (req, res) => res.json({ role: req.user.role }));
  return app;
}

async function csrfHeader(agent) {
  const response = await agent.get('/api/auth/csrf').expect(200);
  const setCookie = response.headers['set-cookie'].find((value) => value.startsWith('csrf_token='));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  return { token: response.body.csrfToken, cookie: setCookie.split(';')[0] };
}

test('registration validates inputs, hashes passwords, never selects a public role, and blocks duplicates', async () => {
  const UserModel = createUserStore(); const audit = []; const app = buildApp(UserModel, audit); const agent = request.agent(app);
  let csrf = await csrfHeader(agent);
  await agent.post('/api/auth/register').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ name: 'Traveler', email: 'bad', password: 'short' }).expect(400);
  const response = await agent.post('/api/auth/register').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ name: 'Traveler', email: ' PERSON@example.com ', password: 'a-very-strong-passphrase', role: 'admin' }).expect(400);
  assert.equal(response.body.error.fields.form, 'Only name, email, and password may be submitted.');
  csrf = await csrfHeader(agent);
  const created = await agent.post('/api/auth/register').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ name: 'Traveler', email: ' PERSON@example.com ', password: 'a-very-strong-passphrase' }).expect(201);
  assert.equal(created.body.user.role, 'traveler');
  assert.equal(created.body.user.passwordHash, undefined);
  const stored = UserModel.records.get('person@example.com');
  assert.notEqual(stored.passwordHash, 'a-very-strong-passphrase');
  assert.equal(audit.some((event) => event.action === 'user.registered'), true);
  assert.equal(JSON.stringify(audit).includes('person@example.com'), false);
  assert.equal(JSON.stringify(audit).includes('strong-passphrase'), false);
  assert.equal(await bcrypt.compare('a-very-strong-passphrase', stored.passwordHash), true);
  const authCookie = created.headers['set-cookie'].find((value) => value.startsWith('access_token='));
  assert.match(authCookie, /HttpOnly/i);
  assert.match(authCookie, /SameSite=Strict/i);
  csrf = { token: created.body.csrfToken, cookie: created.headers['set-cookie'].find((value) => value.startsWith('csrf_token=')).split(';')[0] };
  await agent.post('/api/auth/register').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ name: 'Traveler', email: 'person@example.com', password: 'another-strong-password' }).expect(409);
});

test('login uses generic invalid-credential errors, returns a cookie, and supports current-user and logout', async () => {
  const UserModel = createUserStore(); const app = buildApp(UserModel); const agent = request.agent(app);
  const csrf = await csrfHeader(agent);
  await agent.post('/api/auth/login').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ email: 'missing@example.com', password: 'wrong-password' }).expect(401).expect(({ body }) => assert.equal(body.error.message, 'Email or password is incorrect.'));
  const passwordHash = await bcrypt.hash('a-very-strong-passphrase', 10);
  const traveler = await UserModel.create({ name: 'Traveler', email: 'traveler@example.com', passwordHash, role: 'traveler', accountStatus: 'active' });
  const adminHash = await bcrypt.hash('another-strong-password', 10);
  await UserModel.create({ name: 'Admin', email: 'admin@example.com', passwordHash: adminHash, role: 'admin', accountStatus: 'active' });
  const login = await agent.post('/api/auth/login').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ email: ' TRAVELER@example.com ', password: 'a-very-strong-passphrase' }).expect(200);
  assert.equal(login.body.user.id, traveler._id);
  const access = login.headers['set-cookie'].find((value) => value.startsWith('access_token='));
  await request(app).get('/api/auth/me').expect(401);
  await agent.get('/api/auth/me').expect(200).expect(({ body }) => assert.equal(body.user.email, 'traveler@example.com'));
  await agent.get('/api/traveler').expect(200);
  await agent.get('/api/admin').expect(403);
  const logout = await agent.post('/api/auth/logout').set('X-CSRF-Token', login.body.csrfToken).expect(204);
  assert.ok(logout.headers['set-cookie'].some((value) => value.startsWith('access_token=;') && /Expires=Thu, 01 Jan 1970/i.test(value)));
  assert.ok(access);
  await agent.get('/api/auth/me').expect(401);
});

test('invalid and expired JWTs are rejected and login audit metadata is data-minimized', async () => {
  const UserModel = createUserStore(); const audit = []; const app = buildApp(UserModel, audit);
  const csrf = await csrfHeader(request.agent(app));
  const hash = await bcrypt.hash('another-strong-password', 10);
  const traveler = await UserModel.create({ name: 'Traveler', email: 'traveler@example.com', passwordHash: hash, role: 'traveler', accountStatus: 'active' });
  const jwt = await import('jsonwebtoken');
  const invalid = jwt.default.sign({ sub: traveler._id }, secret, { algorithm: 'HS256', expiresIn: -1, issuer: 'smart-visa-tracker-api', audience: 'smart-visa-tracker-client' });
  await request(app).get('/api/auth/me').set('Cookie', `access_token=${invalid}`).expect(401);
  await request(app).get('/api/auth/me').set('Cookie', 'access_token=not.a.jwt').expect(401);
  await request(app).post('/api/auth/login').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ email: 'traveler@example.com', password: 'wrong-password' }).expect(401);
  assert.equal(audit.some((event) => event.action === 'user.login_failed'), true);
  assert.equal(JSON.stringify(audit).includes('traveler@example.com'), false);
  assert.equal(JSON.stringify(audit).includes('wrong-password'), false);
});

test('administrator can access admin routes and traveler routes reject anonymous access', async () => {
  const UserModel = createUserStore(); const app = buildApp(UserModel); const agent = request.agent(app);
  const csrf = await csrfHeader(agent);
  const passwordHash = await bcrypt.hash('another-strong-password', 10);
  await UserModel.create({ name: 'Admin', email: 'admin@example.com', passwordHash, role: 'admin', accountStatus: 'active' });
  await request(app).get('/api/traveler').expect(401);
  await agent.post('/api/auth/login').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ email: 'admin@example.com', password: 'another-strong-password' }).expect(200);
  await agent.get('/api/admin').expect(200);
  await agent.get('/api/traveler').expect(403);
});

test('cookie-authenticated writes require the CSRF header and bad credentials stay generic', async () => {
  const app = buildApp(createUserStore());
  await request(app).post('/api/auth/logout').expect(403);
  const csrf = await csrfHeader(request(app));
  const login = await request(app).post('/api/auth/login').set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token).send({ email: 'unknown@example.com', password: 'wrong-password' }).expect(401);
  assert.equal(login.body.error.message, 'Email or password is incorrect.');
  await request(app).post('/api/auth/login').set('Cookie', csrf.cookie).send({ email: 'unknown@example.com', password: 'wrong-password' }).expect(403);
});

test('production session cookies use Secure, HttpOnly, SameSite=None, and the __Host prefix', () => {
  const previous = { node: process.env.NODE_ENV, sameSite: process.env.AUTH_COOKIE_SAME_SITE, secure: process.env.AUTH_COOKIE_SECURE };
  process.env.NODE_ENV = 'production'; delete process.env.AUTH_COOKIE_SAME_SITE; delete process.env.AUTH_COOKIE_SECURE;
  try {
    const settings = getAuthSettings();
    assert.equal(settings.cookieName, '__Host-access_token');
    assert.equal(settings.cookieOptions.secure, true);
    assert.equal(settings.cookieOptions.httpOnly, true);
    assert.equal(settings.cookieOptions.sameSite, 'none');
    assert.equal(settings.csrfCookieOptions.httpOnly, true);
  } finally {
    if (previous.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.node;
    if (previous.sameSite === undefined) delete process.env.AUTH_COOKIE_SAME_SITE; else process.env.AUTH_COOKIE_SAME_SITE = previous.sameSite;
    if (previous.secure === undefined) delete process.env.AUTH_COOKIE_SECURE; else process.env.AUTH_COOKIE_SECURE = previous.secure;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { healthHandler } from '../src/routes/health.routes.js';

test('health endpoint handler reports database configuration without exposing credentials', () => {
  const previousUri = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  try {
    let statusCode;
    let body;
    const responseMock = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
    healthHandler({}, responseMock);
    assert.equal(statusCode, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.database, 'not_configured');
    assert.equal(JSON.stringify(body).includes('mongodb'), false);
  } finally {
    if (previousUri !== undefined) process.env.MONGODB_URI = previousUri;
  }
});

// tests/integration/errorAndNotFound.test.js
import request from 'supertest';
import app from '../../server/app.js';

/**
 * Demonstrates 1) requesting an unknown path => 404
 * and 2) forcing an error => 500 from the global error handler.
 */

describe('Error & Not Found Integration Tests', () => {
  // We add a temporary route before running tests:
  beforeAll(() => {
    // Ephemeral test route that throws an error on GET
    // This ensures we can confirm the global error handler.
    app.get('/test/throw-error', (req, res) => {
      throw new Error('Test forced error');
    });
  });

  test('GET /nonexistent-route => 404 Not Found', async () => {
    const res = await request(app).get('/this-route-does-not-exist');
    expect(res.status).toBe(404);

    // By default, Express returns "Cannot GET /..." if no 404 handler is set up.
    // If you have a custom 404 handler, adjust the expectation accordingly:
    // e.g. expect(res.body).toHaveProperty('message', 'Not Found');
    // or:
    expect(res.text).toMatch(/cannot get/i);
  });

  test('GET /test/throw-error => triggers global error handler => 500', async () => {
    const res = await request(app).get('/test/throw-error');

    // We expect the global error handler in app.js to catch it
    // and respond with status 500 plus JSON { message: ... }
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('message', 'Test forced error');
  });
});

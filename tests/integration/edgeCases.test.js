// tests/integration/edgeCases.test.js

import request from 'supertest';
import app from '../../server/app.js';
import { createTestUser, closeDBPool } from './testUtils.js';

describe('Edge Cases Integration Tests', () => {
  let token;

  beforeAll(async () => {
    // Create a user to test with
    const user = await createTestUser({ name: 'EdgeTester' });
    token = user.token;
  });

  afterAll(async () => {
    await closeDBPool();
  });

  test('Creating a project with missing name => uses fallback or fails gracefully', async () => {
    const res = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'No name provided' });
    // If your route requires name strictly, expect 400
    // else if it sets a default name, expect 201 or similar
    // We'll just check for not 500:
    expect([400, 201]).toContain(res.statusCode);
  });

  test('Requesting a non-existent project => 403 or 404 when user is not owner/admin', async () => {
    const getRes = await request(app)
      .get('/projects/99999999') // presumably doesn't exist
      .set('Authorization', `Bearer ${token}`);
    expect([403, 404]).toContain(getRes.statusCode);
  });

  test('Register with a duplicate email => 400 or 409', async () => {
    // We'll create a known user, then re-register the same email
    const existing = await createTestUser({ email: 'edge_dup@example.com' });
    const dup = await request(app).post('/auth/register').send({
      name: 'DupUser',
      email: 'edge_dup@example.com',
      password: 'pass123',
      confirmPassword: 'pass123',
    });
    expect([400, 409]).toContain(dup.statusCode);
  });
});

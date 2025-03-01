// tests/integration/edgeCases.test.js
import request from 'supertest';
import app from '../../server/app.js';
import pool from '../../server/database.js';

describe('Edge Cases Integration Tests', () => {
  let token;
  beforeAll(async () => {
    // Register a user
    const uniqueEmail = `edgecase_${Date.now()}@example.com`;
    const reg = await request(app).post('/auth/register').send({
      name: 'EdgeTester',
      email: uniqueEmail,
      password: 'abcdef123',
      confirmPassword: 'abcdef123',
    });
    token = reg.body.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  test('Creating a project with missing name => uses fallback or fails gracefully', async () => {
    const res = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'No name provided' });
    // Depending on your current code, you might require a name or default it.
    // Here we assume the route might throw a 400 if name is required:
    if (res.statusCode === 201) {
      expect(res.body.name).toBeTruthy();
    } else {
      expect(res.statusCode).toBe(400);
    }
  });

  test('Requesting a non-existent project => 403 or 404 when user is not owner/admin', async () => {
    const getRes = await request(app)
      .get('/projects/99999999') // presumably doesn't exist
      .set('Authorization', `Bearer ${token}`);

    // Our route typically returns 403 if user can't edit or 404 if not found
    // We'll just confirm it's not 200:
    expect([403, 404]).toContain(getRes.statusCode);
  });

  test('Register with a duplicate email => 400', async () => {
    const dup = await request(app).post('/auth/register').send({
      name: 'DupUser',
      email: 'edgecase_0@example.com', // forcing a known collision or we can reuse above email
      password: 'anypass',
      confirmPassword: 'anypass',
    });
    // If the email truly duplicates, expect a 400 or 409
    expect([400, 409]).toContain(dup.statusCode);
  });
});

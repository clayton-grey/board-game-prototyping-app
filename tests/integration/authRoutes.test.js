import request from 'supertest';
import app from '../../server/app.js';
import pool from '../../server/database.js';

// We'll do minimal tests. In a real scenario, you'd have a dedicated test DB
// or you'd mock the DB. For now, let's demonstrate live calls.

describe('Auth Routes Integration', () => {
  afterAll(async () => {
    // Close DB pool to avoid open handles in Jest
    await pool.end();
  });

  test('POST /auth/register with missing fields => 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({}); // no data
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  test('POST /auth/register with valid data => 201 & token', async () => {
    // Warning: if you run this on your real DB, it might conflict if user already exists
    // You might want to randomize the email to avoid collisions or use a test DB
    const uniqueEmail = `test_${Date.now()}@example.com`;
    const res = await request(app)
      .post('/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        name: 'TestUser',
        email: uniqueEmail,
        password: 'secret123',
        confirmPassword: 'secret123'
      });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toHaveProperty('email', uniqueEmail);
  });

  test('POST /auth/login with wrong password => 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'no-such-user@example.com', password: 'wrongpass' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty('message', 'Invalid credentials.');
  });
});

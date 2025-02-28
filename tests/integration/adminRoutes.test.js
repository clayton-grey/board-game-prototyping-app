// tests/integration/adminRoutes.test.js

import request from 'supertest';
import app from '../../server/app.js';
import pool from '../../server/database.js';

/**
 * This integration test suite checks our Admin Routes:
 *  - GET /admin/users
 *  - PUT /admin/users/:id/role
 *  - DELETE /admin/users/:id
 *
 * We'll do live calls. 
 * Typically you'd ensure the test DB is separate from production.
 */

describe('Admin Routes Integration', () => {
  let adminToken;
  let regularToken;
  let testUserId;

  beforeAll(async () => {
    // 1) Create an admin user
    const adminEmail = `admin_${Date.now()}@example.com`;
    const adminRes = await request(app)
      .post('/auth/register')
      .send({
        name: 'AdminTest',
        email: adminEmail,
        password: 'secret123',
        confirmPassword: 'secret123',
      });

    // By default, new user is not an admin. Let's set it in DB manually or 
    // you could do so from some other route or direct DB call. 
    // For simplicity, let's do a direct DB update:
    const newlyCreatedId = adminRes.body.user.id;
    await pool.query('UPDATE users SET role=$1 WHERE id=$2', ['admin', newlyCreatedId]);

    // Re-auth to fetch updated role in the token
    const loginAdmin = await request(app)
      .post('/auth/login')
      .send({
        email: adminEmail,
        password: 'secret123',
      });
    adminToken = loginAdmin.body.token;

    // 2) Create a regular user
    const userEmail = `regular_${Date.now()}@example.com`;
    const userRes = await request(app)
      .post('/auth/register')
      .send({
        name: 'RegularUser',
        email: userEmail,
        password: 'pass1234',
        confirmPassword: 'pass1234'
      });
    regularToken = userRes.body.token;
    testUserId = userRes.body.user.id;
  });

  afterAll(async () => {
    // Close the DB pool to avoid open handles
    await pool.end();
  });

  test('GET /admin/users requires admin token', async () => {
    // With regular user token => should fail
    const res1 = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${regularToken}`)
      .send();
    expect(res1.statusCode).toBe(403);
    expect(res1.body).toHaveProperty('message', 'Access denied. Admins only.');

    // With admin token => success
    const res2 = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send();
    expect(res2.statusCode).toBe(200);
    expect(Array.isArray(res2.body)).toBe(true);
    // We expect at least 2 users in the array now
    expect(res2.body.length).toBeGreaterThanOrEqual(2);
  });

  test('PUT /admin/users/:id/role => update user role', async () => {
    // Attempt as regular => fail
    const res1 = await request(app)
      .put(`/admin/users/${testUserId}/role`)
      .set('Authorization', `Bearer ${regularToken}`)
      .send({ role: 'admin' });
    expect(res1.statusCode).toBe(403);

    // Attempt as admin => success
    const res2 = await request(app)
      .put(`/admin/users/${testUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' });
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toHaveProperty('role', 'admin');

    // Confirm user is actually an admin now
    const finalCheck = await pool.query('SELECT role FROM users WHERE id=$1', [testUserId]);
    expect(finalCheck.rows[0].role).toBe('admin');
  });

  test('DELETE /admin/users/:id => remove user from DB', async () => {
    // First, create a temp user to delete
    const tempEmail = `temp_${Date.now()}@example.com`;
    const tempRes = await request(app)
      .post('/auth/register')
      .send({
        name: 'TempUserToDelete',
        email: tempEmail,
        password: 'xyz123',
        confirmPassword: 'xyz123',
      });
    const tempId = tempRes.body.user.id;

    // Try to delete as a regular user => fail
    const delFail = await request(app)
      .delete(`/admin/users/${tempId}`)
      .set('Authorization', `Bearer ${regularToken}`);
    expect(delFail.statusCode).toBe(403);

    // Delete as admin => success
    const delOk = await request(app)
      .delete(`/admin/users/${tempId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delOk.statusCode).toBe(200);
    expect(delOk.body).toHaveProperty('message', 'User deleted');

    // Verify DB removal
    const check = await pool.query('SELECT * FROM users WHERE id=$1', [tempId]);
    expect(check.rowCount).toBe(0);
  });
});

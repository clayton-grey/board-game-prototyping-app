// ./tests/integration/projectRoutes.test.js

import request from 'supertest';
import app from '../../server/app.js';
import pool from '../../server/database.js';

describe('Project Routes Integration (Two-Project Technique)', () => {
  let user1Token, user1Id;
  let user2Token, user2Id;
  let adminToken, adminId;

  let projectA; // for user1's normal flow
  let projectB; // for admin override tests

  beforeAll(async () => {
    /**
     * 1) Register User1 (owner)
     */
    const user1Email = `owner_${Date.now()}@example.com`;
    const reg1 = await request(app)
      .post('/auth/register')
      .send({
        name: 'UserOneOwner',
        email: user1Email,
        password: 'user1pass',
        confirmPassword: 'user1pass',
      });
    user1Token = reg1.body.token;
    user1Id = reg1.body.user.id;

    /**
     * 2) Register User2 (non-owner)
     */
    const user2Email = `nonowner_${Date.now()}@example.com`;
    const reg2 = await request(app)
      .post('/auth/register')
      .send({
        name: 'UserTwoThief',
        email: user2Email,
        password: 'user2pass',
        confirmPassword: 'user2pass',
      });
    user2Token = reg2.body.token;
    user2Id = reg2.body.user.id;

    /**
     * 3) Register User3 => will be admin
     */
    const adminEmail = `admin_${Date.now()}@example.com`;
    const reg3 = await request(app)
      .post('/auth/register')
      .send({
        name: 'UserThreeAdmin',
        email: adminEmail,
        password: 'adminpass',
        confirmPassword: 'adminpass',
      });
    adminToken = reg3.body.token;
    adminId = reg3.body.user.id;

    // Manually set user3 role='admin' in DB
    await pool.query('UPDATE users SET role=$1 WHERE id=$2', ['admin', adminId]);

    // Re-login user3 to refresh the JWT with role='admin'
    const adminLogin = await request(app)
      .post('/auth/login')
      .send({
        email: adminEmail,
        password: 'adminpass',
      });
    adminToken = adminLogin.body.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  // -----------------------------
  // PART A: Project A -> Owned by user1
  // -----------------------------

  test('User1 creates Project A => 201', async () => {
    const createRes = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Project A',
        description: 'For user1 testing',
      });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body.owner_id).toBe(user1Id);
    projectA = createRes.body.id;
  });

  describe('User2 tries to access Project A => 403', () => {
    test('User2 tries to update => 403', async () => {
      const res = await request(app)
        .put(`/projects/${projectA}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'HackedName' });
      expect(res.statusCode).toBe(403);
      expect(res.body).toHaveProperty('message', 'Not authorized or project not found.');
    });

    test('User2 tries to delete => 403', async () => {
      const del = await request(app)
        .delete(`/projects/${projectA}`)
        .set('Authorization', `Bearer ${user2Token}`);
      expect(del.statusCode).toBe(403);
      expect(del.body).toHaveProperty('message', 'Not authorized or project not found.');
    });

    test('User2 tries listing versions => 403', async () => {
      const vers = await request(app)
        .get(`/projects/${projectA}/versions`)
        .set('Authorization', `Bearer ${user2Token}`);
      expect(vers.statusCode).toBe(403);
      expect(vers.body).toHaveProperty('message', 'Not authorized or project not found.');
    });
  });

  test('User1 updates Project A => 200', async () => {
    const res = await request(app)
      .put(`/projects/${projectA}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'My Updated Project A',
        description: 'Changed desc A',
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('My Updated Project A');
    expect(res.body.description).toBe('Changed desc A');
  });

  test('User1 lists versions of Project A => initially none => 200', async () => {
    const versionsRes = await request(app)
      .get(`/projects/${projectA}/versions`)
      .set('Authorization', `Bearer ${user1Token}`);
    expect(versionsRes.statusCode).toBe(200);
    expect(Array.isArray(versionsRes.body)).toBe(true);
    expect(versionsRes.body.length).toBe(0);
  });

  test('User1 creates version on Project A => 201', async () => {
    const payload = { project_data: { someKey: 'someValueA' } };
    const verRes = await request(app)
      .post(`/projects/${projectA}/versions`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send(payload);
    expect(verRes.statusCode).toBe(201);
    expect(verRes.body).toHaveProperty('id');
    expect(verRes.body).toHaveProperty('version_number', 1);
  });

  test('User1 lists versions => now we have 1 => 200', async () => {
    const versionsRes = await request(app)
      .get(`/projects/${projectA}/versions`)
      .set('Authorization', `Bearer ${user1Token}`);
    expect(versionsRes.statusCode).toBe(200);
    expect(Array.isArray(versionsRes.body)).toBe(true);
    expect(versionsRes.body.length).toBe(1);
    expect(versionsRes.body[0].version_number).toBe(1);
  });

  test('User1 deletes Project A => 200', async () => {
    const del = await request(app)
      .delete(`/projects/${projectA}`)
      .set('Authorization', `Bearer ${user1Token}`);
    expect(del.statusCode).toBe(200);
    expect(del.body).toHaveProperty('message', 'Project deleted');

    // Confirm it's really gone
    const check = await pool.query('SELECT * FROM projects WHERE id=$1', [projectA]);
    expect(check.rowCount).toBe(0);
  });

  // -----------------------------
  // PART B: Project B -> Also owned by user1, but admin will override
  // -----------------------------

  test('User1 creates Project B => 201', async () => {
    const createB = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Project B',
        description: 'For admin override tests',
      });
    expect(createB.statusCode).toBe(201);
    projectB = createB.body.id;
  });

  test('Admin forcibly updates Project B => 200', async () => {
    const res = await request(app)
      .put(`/projects/${projectB}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Admin Overrode B',
        description: 'Admin changed B desc',
      });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('id', projectB);
    expect(res.body.name).toBe('Admin Overrode B');
  });

  test('Admin forcibly deletes Project B => 200', async () => {
    const del = await request(app)
      .delete(`/projects/${projectB}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.statusCode).toBe(200);
    expect(del.body).toHaveProperty('message', 'Project deleted');
  });

  // -----------------------------
  // PART C: Ensure Default => now user1 has 0 projects
  // -----------------------------

  describe('GET /projects/ensureDefault => ensures at least one project', () => {
    let defaultProjectId = null;

    test('returns 401 if not logged in', async () => {
      const res = await request(app).get('/projects/ensureDefault');
      expect(res.statusCode).toBe(401);
    });

    test('when user1 has no projects, returns a new default => 200', async () => {
      const res = await request(app)
        .get('/projects/ensureDefault')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body.owner_id).toBe(user1Id);
      defaultProjectId = res.body.id;
    });

    test('calling again returns the same default (not new) => 200', async () => {
      const res2 = await request(app)
        .get('/projects/ensureDefault')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(res2.statusCode).toBe(200);
      expect(res2.body).toHaveProperty('id', defaultProjectId);
    });
  });
});

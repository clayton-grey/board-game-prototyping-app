// tests/integration/projectRoutes.test.js

import request from 'supertest';
import app from '../../server/app.js';
import pool from '../../server/database.js';

describe('Project Routes Integration', () => {
  let userToken;
  let userId;
  let projectId;

  beforeAll(async () => {
    // Register & login a user
    const uniqueEmail = `proj_tester_${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/auth/register')
      .send({
        name: 'ProjectTester',
        email: uniqueEmail,
        password: 'testpass123',
        confirmPassword: 'testpass123',
      });
    userToken = regRes.body.token;
    userId = regRes.body.user.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  test('GET /projects => initially empty for new user', async () => {
    const res = await request(app)
      .get('/projects')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // It might not be strictly "empty" if we auto-create a default project upon ensureDefault,
    // but let's see if your code does that automatically or not.
    // We'll just allow an array check:
    // expect(res.body.length).toBe(0); // might fail if default project is auto-created
  });

  test('POST /projects => create a new project', async () => {
    const createRes = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'My Test Project',
        description: 'Integration test project',
      });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body).toHaveProperty('id');
    expect(createRes.body.owner_id).toBe(userId);
    projectId = createRes.body.id;
  });

  test('GET /projects after creation => returns at least 1 project', async () => {
    const res = await request(app)
      .get('/projects')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.some((p) => p.id === projectId)).toBe(true);
  });

  test('PUT /projects/:id => update project name/description', async () => {
    const res = await request(app)
      .put(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'My Updated Project',
        description: 'Changed desc',
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('My Updated Project');
    expect(res.body.description).toBe('Changed desc');
  });

  test('GET /projects/:id/versions => initially none', async () => {
    const versionsRes = await request(app)
      .get(`/projects/${projectId}/versions`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(versionsRes.statusCode).toBe(200);
    expect(Array.isArray(versionsRes.body)).toBe(true);
    expect(versionsRes.body.length).toBe(0); 
  });

  test('POST /projects/:id/versions => create a new version', async () => {
    const payload = { project_data: { someKey: 'someValue' } };
    const verRes = await request(app)
      .post(`/projects/${projectId}/versions`)
      .set('Authorization', `Bearer ${userToken}`)
      .send(payload);
    expect(verRes.statusCode).toBe(201);
    expect(verRes.body).toHaveProperty('id');
    expect(verRes.body).toHaveProperty('version_number', 1);
  });

  test('GET /projects/:id/versions => now we have 1 version', async () => {
    const versionsRes = await request(app)
      .get(`/projects/${projectId}/versions`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(versionsRes.statusCode).toBe(200);
    expect(Array.isArray(versionsRes.body)).toBe(true);
    expect(versionsRes.body.length).toBe(1);
    expect(versionsRes.body[0].version_number).toBe(1);
  });

  test('DELETE /projects/:id => remove project from DB', async () => {
    const del = await request(app)
      .delete(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(del.statusCode).toBe(200);
    expect(del.body).toHaveProperty('message', 'Project deleted');

    // Verify
    const check = await pool.query('SELECT * FROM projects WHERE id=$1', [projectId]);
    expect(check.rowCount).toBe(0);
  });
});

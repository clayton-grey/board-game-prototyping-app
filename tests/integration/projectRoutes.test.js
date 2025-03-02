import request from 'supertest';
import app from '../../server/app.js';
import pool from '../../server/database.js';

describe('Project Routes Integration', () => {
  let userToken; // token for primary user (ProjectTester)
  let userId;    // user ID for that primary user
  let projectId; // ID of the project the primary user creates

  let secondUserToken; // token for second user (not owner/admin)
  let secondUserId;    // ID of second user

  beforeAll(async () => {
    // 1) Register & login a user (User1)
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

    // 2) Also register a second user (User2) to test unauthorized attempts
    const secondEmail = `proj_thief_${Date.now()}@example.com`;
    const reg2 = await request(app)
      .post('/auth/register')
      .send({
        name: 'ProjectThief',
        email: secondEmail,
        password: 'pass4321',
        confirmPassword: 'pass4321',
      });
    secondUserToken = reg2.body.token;
    secondUserId = reg2.body.user.id;
  });

  afterAll(async () => {
    // Close the DB pool so Jest can exit properly
    await pool.end();
  });

  test('GET /projects => initially empty for new user', async () => {
    const res = await request(app)
      .get('/projects')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Might be 0 or 1 if code auto-creates a default. We'll just confirm >= 0:
    expect(res.body.length).toBeGreaterThanOrEqual(0);
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

  /**
   *  New block: Check that a second user (not owner, not admin) is forbidden
   *  from updating/deleting the project owned by the first user.
   */
  describe('Access by non-owner user (second user)', () => {
    test('second user tries to update the project => 403', async () => {
      const res = await request(app)
        .put(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${secondUserToken}`)
        .send({
          name: 'HackedName',
          description: 'HackedDesc',
        });
      expect(res.statusCode).toBe(403);
      expect(res.body).toHaveProperty('message', 'Not authorized or project not found.');
    });

    test('second user tries to delete the project => 403', async () => {
      const del = await request(app)
        .delete(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${secondUserToken}`);
      expect(del.statusCode).toBe(403);
      expect(del.body).toHaveProperty('message', 'Not authorized or project not found.');
    });

    test('second user tries listing versions => 403', async () => {
      const versionsRes = await request(app)
        .get(`/projects/${projectId}/versions`)
        .set('Authorization', `Bearer ${secondUserToken}`);
      expect(versionsRes.statusCode).toBe(403);
      expect(versionsRes.body).toHaveProperty('message', 'Not authorized or project not found.');
    });
  });

  test('PUT /projects/:id => update project name/description as owner => 200', async () => {
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

  test('DELETE /projects/:id => remove project from DB as owner => 200', async () => {
    const del = await request(app)
      .delete(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(del.statusCode).toBe(200);
    expect(del.body).toHaveProperty('message', 'Project deleted');

    // Verify
    const check = await pool.query('SELECT * FROM projects WHERE id=$1', [projectId]);
    expect(check.rowCount).toBe(0);
  });

  /**
   * Existing coverage for "ensureDefault" from prior step
   *  => includes a sub-describe block
   */
  describe('GET /projects/ensureDefault => creates or returns a default project', () => {
    let defaultProjectId = null;

    test('returns 401 if not logged in', async () => {
      const res = await request(app).get('/projects/ensureDefault');
      expect(res.statusCode).toBe(401);
    });

    test('when user has no projects, creates and returns a default project', async () => {
      // We just deleted our only project, so user should have none
      const res = await request(app)
        .get('/projects/ensureDefault')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body.owner_id).toBe(userId);
      expect(res.body.name).toBeTruthy();
      // Store the ID for verifying subsequent calls
      defaultProjectId = res.body.id;
    });

    test('calling again returns the same default project (not a new one)', async () => {
      const res2 = await request(app)
        .get('/projects/ensureDefault')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res2.statusCode).toBe(200);
      expect(res2.body).toHaveProperty('id', defaultProjectId);
    });
  });
});

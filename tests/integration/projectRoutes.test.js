// tests/integration/projectRoutes.test.js

import request from "supertest";
import app from "../../server/app.js";
import { createTestUser, closeDBPool } from "./testUtils.js";

describe("Project Routes Integration (Two-Project Technique)", () => {
  let user1Token, user1Id;
  let user2Token, user2Id;
  let adminToken, adminId;

  let projectA; // for user1's normal flow
  let projectB; // for admin override tests

  beforeAll(async () => {
    // 1) Create User1 (owner)
    const user1 = await createTestUser({ name: "UserOneOwner" });
    user1Token = user1.token;
    user1Id = user1.userId;

    // 2) Create User2 (non-owner)
    const user2 = await createTestUser({ name: "UserTwoThief" });
    user2Token = user2.token;
    user2Id = user2.userId;

    // 3) Create admin user
    const adminUser = await createTestUser({
      role: "admin",
      name: "UserThreeAdmin",
    });
    adminToken = adminUser.token;
    adminId = adminUser.userId;
  });

  afterAll(async () => {
    await closeDBPool();
  });

  // PART A
  test("User1 creates Project A => 201", async () => {
    const createRes = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        name: "Project A",
        description: "For user1 testing",
      });
    expect(createRes.statusCode).toBe(201);
    projectA = createRes.body.id;
  });

  describe("User2 tries to access Project A => 403", () => {
    test("User2 tries to update => 403", async () => {
      const res = await request(app)
        .put(`/projects/${projectA}`)
        .set("Authorization", `Bearer ${user2Token}`)
        .send({ name: "HackedName" });
      expect(res.statusCode).toBe(403);
    });

    test("User2 tries to delete => 403", async () => {
      const del = await request(app)
        .delete(`/projects/${projectA}`)
        .set("Authorization", `Bearer ${user2Token}`);
      expect(del.statusCode).toBe(403);
    });
  });

  test("User1 updates Project A => 200", async () => {
    const res = await request(app)
      .put(`/projects/${projectA}`)
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        name: "My Updated Project A",
        description: "Changed desc A",
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe("My Updated Project A");
  });

  test("User1 lists versions of Project A => initially none => 200", async () => {
    const versionsRes = await request(app)
      .get(`/projects/${projectA}/versions`)
      .set("Authorization", `Bearer ${user1Token}`);
    expect(versionsRes.statusCode).toBe(200);
    expect(Array.isArray(versionsRes.body)).toBe(true);
    expect(versionsRes.body.length).toBe(0);
  });

  test("User1 creates version on Project A => 201", async () => {
    const payload = { project_data: { someKey: "someValueA" } };
    const verRes = await request(app)
      .post(`/projects/${projectA}/versions`)
      .set("Authorization", `Bearer ${user1Token}`)
      .send(payload);
    expect(verRes.statusCode).toBe(201);
    expect(verRes.body.version_number).toBe(1);
  });

  test("User1 deletes Project A => 200", async () => {
    const del = await request(app)
      .delete(`/projects/${projectA}`)
      .set("Authorization", `Bearer ${user1Token}`);
    expect(del.statusCode).toBe(200);
    expect(del.body).toHaveProperty("message", "Project deleted");
  });

  // PART B
  test("User1 creates Project B => 201", async () => {
    const createB = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        name: "Project B",
        description: "For admin override tests",
      });
    expect(createB.statusCode).toBe(201);
    projectB = createB.body.id;
  });

  test("Admin forcibly updates Project B => 200", async () => {
    const res = await request(app)
      .put(`/projects/${projectB}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Admin Overrode B",
        description: "Admin changed B desc",
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(projectB);
    expect(res.body.name).toBe("Admin Overrode B");
  });

  test("Admin forcibly deletes Project B => 200", async () => {
    const del = await request(app)
      .delete(`/projects/${projectB}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(del.statusCode).toBe(200);
    expect(del.body).toHaveProperty("message", "Project deleted");
  });

  // PART C
  describe("GET /projects/ensureDefault => ensures at least one project", () => {
    let defaultProjectId = null;

    test("returns 401 if not logged in", async () => {
      const res = await request(app).get("/projects/ensureDefault");
      expect(res.statusCode).toBe(401);
    });

    test("when user1 has no projects, returns a new default => 200", async () => {
      const res = await request(app)
        .get("/projects/ensureDefault")
        .set("Authorization", `Bearer ${user1Token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("id");
      defaultProjectId = res.body.id;
    });

    test("calling again returns the same default => 200", async () => {
      const res2 = await request(app)
        .get("/projects/ensureDefault")
        .set("Authorization", `Bearer ${user1Token}`);
      expect(res2.statusCode).toBe(200);
      expect(res2.body.id).toBe(defaultProjectId);
    });
  });
});

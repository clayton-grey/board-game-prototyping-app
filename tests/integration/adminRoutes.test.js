// tests/integration/adminRoutes.test.js

import request from "supertest";
import app from "../../server/app.js";
// We remove direct "pool" import and use closeDBPool() instead
import { createTestUser, closeDBPool } from "./testUtils.js";

/**
 * Integration tests for admin routes
 *   - GET /admin/users
 *   - PUT /admin/users/:id/role
 *   - DELETE /admin/users/:id
 */
describe("Admin Routes Integration", () => {
  let adminToken;
  let regularToken;
  let testUserId;

  beforeAll(async () => {
    // 1) Create an admin user
    const admin = await createTestUser({ role: "admin", name: "AdminTest" });
    adminToken = admin.token;

    // 2) Create a regular user
    const regular = await createTestUser({ name: "RegularUser" });
    regularToken = regular.token;
    testUserId = regular.userId;
  });

  afterAll(async () => {
    // Clean up DB connections
    await closeDBPool();
  });

  test("GET /admin/users requires admin token", async () => {
    // With regular user token => should fail
    const res1 = await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${regularToken}`);
    expect(res1.statusCode).toBe(403);
    expect(res1.body).toHaveProperty("message", "Access denied. Admins only.");

    // With admin token => success
    const res2 = await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res2.statusCode).toBe(200);
    expect(Array.isArray(res2.body)).toBe(true);
  });

  test("PUT /admin/users/:id/role => update user role", async () => {
    // Attempt as regular => fail
    const res1 = await request(app)
      .put(`/admin/users/${testUserId}/role`)
      .set("Authorization", `Bearer ${regularToken}`)
      .send({ role: "admin" });
    expect(res1.statusCode).toBe(403);

    // Attempt as admin => success
    const res2 = await request(app)
      .put(`/admin/users/${testUserId}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "admin" });
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toHaveProperty("role", "admin");
  });

  test("DELETE /admin/users/:id => remove user from DB", async () => {
    // First, create a temp user
    const temp = await createTestUser({ name: "TempUserToDelete" });
    const tempId = temp.userId;

    // Try to delete as a regular user => fail
    const delFail = await request(app)
      .delete(`/admin/users/${tempId}`)
      .set("Authorization", `Bearer ${regularToken}`);
    expect(delFail.statusCode).toBe(403);

    // Delete as admin => success
    const delOk = await request(app)
      .delete(`/admin/users/${tempId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(delOk.statusCode).toBe(200);
    expect(delOk.body).toHaveProperty("message", "User deleted");
  });
});

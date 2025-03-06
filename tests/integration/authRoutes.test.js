// tests/integration/authRoutes.test.js

import request from "supertest";
import app from "../../server/app.js";
import { closeDBPool } from "./testUtils.js";

describe("Auth Routes Integration", () => {
  afterAll(async () => {
    await closeDBPool();
  });

  test("POST /auth/register with missing fields => 400", async () => {
    const res = await request(app).post("/auth/register").send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("message");
  });

  test("POST /auth/register with valid data => 201 & token", async () => {
    const uniqueEmail = `test_${Date.now()}@example.com`;
    const res = await request(app).post("/auth/register").send({
      name: "TestUser",
      email: uniqueEmail,
      password: "secret123",
      confirmPassword: "secret123",
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user.email).toBe(uniqueEmail);
  });

  test("POST /auth/login with wrong password => 401", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "no-such-user@example.com", password: "wrongpass" });
    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty("message", "Invalid credentials.");
  });
});

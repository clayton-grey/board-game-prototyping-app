// tests/integration/testUtils.js

import request from "supertest";
import app from "../../server/app.js";
import pool from "../../server/database.js";

/**
 * Creates a new user by calling POST /auth/register,
 * then optionally updates them to 'admin' in the DB
 * if { role: 'admin' } is requested.
 * Finally, re-logs in to retrieve a fresh token if needed.
 *
 * Returns an object: {
 *   token: string,
 *   userId: number,
 *   email: string,
 *   role: 'user' or 'admin'
 * }
 */
export async function createTestUser({
  name = "TestUser",
  email = `test_${Date.now()}@example.com`,
  password = "secret123",
  role = "user",
} = {}) {
  // Step 1: Register the user normally
  const reg = await request(app).post("/auth/register").send({
    name,
    email,
    password,
    confirmPassword: password,
  });

  if (reg.statusCode !== 201) {
    throw new Error(
      `Failed to register test user: ${reg.statusCode} => ${reg.body.message || reg.text}`,
    );
  }

  const { token, user } = reg.body;
  let finalToken = token;
  let finalRole = user.role; // typically 'user'

  // Step 2: If 'admin' role was requested, update the DB, then re-login
  if (role === "admin") {
    await pool.query("UPDATE users SET role=$1 WHERE id=$2", [
      "admin",
      user.id,
    ]);
    const reLogin = await request(app)
      .post("/auth/login")
      .send({ email, password });
    finalToken = reLogin.body.token;
    finalRole = "admin";
  }

  return {
    token: finalToken,
    userId: user.id,
    email,
    role: finalRole,
  };
}

/**
 * Call this afterAll to properly close the DB pool,
 * ensuring Jest does not hang waiting for open handles.
 */
export async function closeDBPool() {
  await pool.end();
}

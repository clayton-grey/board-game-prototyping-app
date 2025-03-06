// tests/integration/errorAndNotFound.test.js

import request from "supertest";
import app from "../../server/app.js";
import { closeDBPool } from "./testUtils.js";

describe("Error & Not Found Integration Tests", () => {
  // Add ephemeral route for forced error
  beforeAll(() => {
    app.get("/test/throw-error", (req, res) => {
      throw new Error("Test forced error");
    });
  });

  afterAll(async () => {
    await closeDBPool();
  });

  test("GET /nonexistent-route => 404 Not Found", async () => {
    const res = await request(app).get("/this-route-does-not-exist");
    expect(res.status).toBe(404);
    // By default, Express might respond with "Cannot GET /..."
    // or your custom 404 handler might produce JSON
  });

  test("GET /test/throw-error => triggers global error handler => 500", async () => {
    const res = await request(app).get("/test/throw-error");
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("message", "Test forced error");
  });
});

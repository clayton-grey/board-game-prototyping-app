// tests/unit/UserService.test.js
import bcrypt from "bcryptjs";
import { UserService } from "../../server/services/UserService.js";
import pool from "../../server/database.js";
import { HttpError } from "../../server/utils/HttpError.js";

// Mock the database module
jest.mock("../../server/database.js", () => {
  return {
    __esModule: true,
    default: {
      query: jest.fn(),
    },
  };
});

describe("UserService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("createUser throws HttpError if email already used", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, email: "existing@example.com" }],
    });

    await expect(
      UserService.createUser("TestUser", "existing@example.com", "pass123"),
    ).rejects.toThrow(HttpError);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("createUser inserts a new user if email not found", async () => {
    // 1) DB returns empty => no user
    pool.query.mockResolvedValueOnce({ rows: [] });

    // 2) Insert the new user
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 2, name: "TestUser", email: "test@example.com" }],
    });

    const result = await UserService.createUser(
      "TestUser",
      "test@example.com",
      "pass123",
    );
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      id: 2,
      name: "TestUser",
      email: "test@example.com",
    });
  });

  test("comparePasswords returns true for correct match", async () => {
    const plain = "secret";
    const hashed = await bcrypt.hash(plain, 10);
    const isMatch = await UserService.comparePasswords(plain, hashed);
    expect(isMatch).toBe(true);
  });

  test("comparePasswords returns false for incorrect match", async () => {
    const plain = "secret";
    const hashed = await bcrypt.hash("otherpassword", 10);
    const isMatch = await UserService.comparePasswords(plain, hashed);
    expect(isMatch).toBe(false);
  });
});

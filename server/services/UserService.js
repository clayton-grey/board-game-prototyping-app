// =========================
// FILE: server/services/UserService.js
// =========================

import pool from "../database.js";
import bcrypt from "bcryptjs";
import { HttpError } from "../utils/HttpError.js";

export class UserService {
  static async getByEmail(email) {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  static async emailExists(email) {
    const existing = await this.getByEmail(email);
    return !!existing;
  }

  static async createUser(name, email, plainPassword) {
    const existing = await this.getByEmail(email);
    if (existing) {
      throw new HttpError("Email is already in use.", 400);
    }
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, role",
      [name, email, hashedPassword],
    );
    return result.rows[0];
  }

  static async comparePasswords(plainText, hashed) {
    return bcrypt.compare(plainText, hashed);
  }

  static async listAll() {
    const result = await pool.query("SELECT id, email, role FROM users");
    return result.rows;
  }

  static async updateRole(userId, newRole) {
    const result = await pool.query(
      "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role",
      [newRole, userId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  static async deleteUser(userId) {
    const result = await pool.query(
      "DELETE FROM users WHERE id = $1 RETURNING *",
      [userId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * New method => used by fetchUserOrThrow in adminRoutes.js
   */
  static async getById(userId) {
    const result = await pool.query(
      "SELECT id, name, email, role FROM users WHERE id = $1",
      [userId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0];
  }
}

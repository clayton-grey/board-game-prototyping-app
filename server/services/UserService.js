// server/services/UserService.js

import pool from '../database.js';
import bcrypt from 'bcryptjs';
import { HttpError } from '../utils/HttpError.js';

export class UserService {
  /**
   * Return user row or null if not found.
   */
  static async getByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * Hash the password and insert a new user row.
   * Throw HttpError if email is already in use.
   */
  static async createUser(name, email, plainPassword) {
    // Check if user already exists
    const existing = await this.getByEmail(email);
    if (existing) {
      throw new HttpError('Email is already in use.', 400);
    }

    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, role',
      [name, email, hashedPassword]
    );
    return result.rows[0]; // newly created user
  }

  /**
   * Compare plain text with hashed password.
   */
  static async comparePasswords(plainText, hashed) {
    return bcrypt.compare(plainText, hashed);
  }

  /**
   * List all users (id, email, role). For admin usage
   */
  static async listAll() {
    const result = await pool.query('SELECT id, email, role FROM users');
    return result.rows;
  }

  /**
   * Update user role, return updated user row or null if not found.
   */
  static async updateRole(userId, newRole) {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role',
      [newRole, userId]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * Delete a user, return deleted user row or null if not found.
   */
  static async deleteUser(userId) {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }
}

// server/services/AuthService.js
import jwt from 'jsonwebtoken';
import config from '../config.js';

/**
 * Centralizes all logic for creating and verifying JWTs,
 * plus transforms from user row -> token payload.
 */
export class AuthService {
  /**
   * Returns the payload object you want to store in the token.
   * For example, user ID, email, role, name, etc.
   */
  static userPayload(user) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };
  }

  /**
   * Create a JWT string from a given payload object.
   */
  static createToken(payload, expiresIn = '1h') {
    return jwt.sign(payload, config.JWT_SECRET, { expiresIn });
  }

  /**
   * Verify a JWT string. If invalid, this throws an error.
   * On success, returns the decoded payload.
   */
  static verifyToken(token) {
    return jwt.verify(token, config.JWT_SECRET);
  }
}

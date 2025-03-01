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
   * We now include `role` and set `isAdmin` = true if role === 'admin'.
   */
  static userPayload(user) {
    return {
      id: user.id,
      email: user.email,
      role: user.role, 
      name: user.name,
      isAdmin: user.role === 'admin'
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
   * On success, returns the decoded payload (including `isAdmin`).
   */
  static verifyToken(token) {
    return jwt.verify(token, config.JWT_SECRET);
  }
}

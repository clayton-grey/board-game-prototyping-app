// =========================
// FILE: server/routes/auth.js
// =========================

import express from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/HttpError.js';
import { UserService } from '../services/UserService.js';
import { AuthService } from '../services/AuthService.js';

const router = express.Router();

/**
 * POST /auth/register
 * Body: { name, email, password, confirmPassword }
 */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password, confirmPassword } = req.body;
    if (!name || !email || !password || !confirmPassword) {
      throw new HttpError('All fields are required.', 400);
    }
    if (password !== confirmPassword) {
      throw new HttpError('Passwords do not match.', 400);
    }

    const user = await UserService.createUser(name, email, password);
    const payload = AuthService.userPayload(user);
    const token = AuthService.createToken(payload, '1h');

    return res.status(201).json({
      message: 'User registered successfully',
      user,
      token,
    });
  })
);

/**
 * POST /auth/login
 * Body: { email, password }
 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await UserService.getByEmail(email);
    if (!user) {
      // 401 => invalid credentials
      throw new HttpError('Invalid credentials.', 401);
    }

    const isMatch = await UserService.comparePasswords(password, user.password);
    if (!isMatch) {
      throw new HttpError('Invalid credentials.', 401);
    }

    // Build & sign JWT
    const payload = AuthService.userPayload(user);
    const token = AuthService.createToken(payload, '1h');

    return res.json({
      message: 'Logged in successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    });
  })
);

export default router;

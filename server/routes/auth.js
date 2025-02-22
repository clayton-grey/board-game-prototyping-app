// server/routes/auth.js
import express from 'express';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/HttpError.js';
import { UserService } from '../services/UserService.js';

const router = express.Router();

/**
 * POST /auth/register
 * Body: { name, email, password, confirmPassword }
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (!name || !email || !password || !confirmPassword) {
    throw new HttpError('All fields are required.', 400);
  }
  if (password !== confirmPassword) {
    throw new HttpError('Passwords do not match.', 400);
  }

  // createUser() will throw HttpError if email is in use
  const user = await UserService.createUser(name, email, password);

  // Create token
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );

  return res.status(201).json({
    message: 'User registered successfully',
    user,
    token,
  });
}));

/**
 * POST /auth/login
 * Body: { email, password }
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await UserService.getByEmail(email);
  if (!user) {
    throw new HttpError('Invalid credentials.', 401);
  }

  const isMatch = await UserService.comparePasswords(password, user.password);
  if (!isMatch) {
    throw new HttpError('Invalid credentials.', 401);
  }

  // create JWT
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );

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
}));

export default router;

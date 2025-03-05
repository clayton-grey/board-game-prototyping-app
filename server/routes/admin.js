// =========================
// FILE: server/routes/admin.js
// =========================

import express from 'express';
import { authenticateToken, authorizeAdmin } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/HttpError.js';
import { UserService } from '../services/UserService.js';

const router = express.Router();

// Helper for user checks
async function fetchUserOrThrow(id) {
  const user = await UserService.getById(id);
  if (!user) {
    throw new HttpError('User not found.', 404);
  }
  return user;
}

// GET /admin/users
router.get(
  '/users',
  authenticateToken,
  authorizeAdmin,
  asyncHandler(async (req, res) => {
    const users = await UserService.listAll();
    return res.json(users);
  })
);

// PUT /admin/users/:id/role
router.put(
  '/users/:id/role',
  authenticateToken,
  authorizeAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    await fetchUserOrThrow(id);
    const updated = await UserService.updateRole(id, role);
    // updated is never null if fetchUserOrThrow passed, but we stay consistent
    if (!updated) {
      throw new HttpError('User not found.', 404);
    }
    return res.json(updated);
  })
);

// DELETE /admin/users/:id
router.delete(
  '/users/:id',
  authenticateToken,
  authorizeAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await fetchUserOrThrow(id);

    const deleted = await UserService.deleteUser(id);
    if (!deleted) {
      throw new HttpError('User not found.', 404);
    }
    return res.json({ message: 'User deleted' });
  })
);

export default router;

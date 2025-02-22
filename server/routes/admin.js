// server/routes/admin.js
import express from 'express';
import { authenticateToken, authorizeAdmin } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/HttpError.js';
import { UserService } from '../services/UserService.js';

const router = express.Router();

// GET /admin/users
router.get('/users', authenticateToken, authorizeAdmin, asyncHandler(async (req, res) => {
  const users = await UserService.listAll();
  return res.json(users);
}));

// PUT /admin/users/:id/role
router.put('/users/:id/role', authenticateToken, authorizeAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const updated = await UserService.updateRole(id, role);
  if (!updated) {
    throw new HttpError('User not found', 404);
  }
  return res.json(updated);
}));

// DELETE /admin/users/:id
router.delete('/users/:id', authenticateToken, authorizeAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deleted = await UserService.deleteUser(id);
  if (!deleted) {
    throw new HttpError('User not found', 404);
  }
  return res.json({ message: 'User deleted' });
}));

export default router;

// =========================
// FILE: server/routes/projects.js
// =========================

import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/HttpError.js';
import { ProjectService } from '../services/ProjectService.js';
import { SessionService } from '../services/SessionService.js';

const router = express.Router();

/**
 * checkProjectEditorPermission => if user can't edit, throw 403 or project not found => 404
 */
async function checkProjectEditorPermission(req, res, next) {
  const { id } = req.params; // project id
  const canEdit = await ProjectService.userCanEditProject(id, req.user);
  if (!canEdit) {
    throw new HttpError('Not authorized or project not found.', 403);
  }
  return next();
}

/**
 * GET /projects/ensureDefault
 */
router.get(
  '/ensureDefault',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const project = await ProjectService.createDefaultProjectIfNone(req.user.id);
    return res.json(project);
  })
);

/**
 * POST /projects
 */
router.post(
  '/',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;
    if (!req.user || !req.user.id) {
      throw new HttpError('User ID is missing from request', 400);
    }
    if (!name) {
      throw new HttpError('Project name is required', 400);
    }

    const project = await ProjectService.createProject(req.user.id, name, description);
    return res.status(201).json(project);
  })
);

/**
 * GET /projects
 */
router.get(
  '/',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const projects = await ProjectService.getProjectsByOwner(req.user.id);
    return res.json(projects);
  })
);

/**
 * PUT /projects/:id
 */
router.put(
  '/:id',
  authenticateToken,
  asyncHandler(checkProjectEditorPermission),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    let { name, description } = req.body;
    if (!description) description = '';

    const updated = await ProjectService.updateProject(id, name, description);
    if (!updated) {
      throw new HttpError('Project not found', 404);
    }
    return res.json(updated);
  })
);

/**
 * DELETE /projects/:id
 */
router.delete(
  '/:id',
  authenticateToken,
  asyncHandler(checkProjectEditorPermission),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const deleted = await ProjectService.deleteProject(id);
    if (!deleted) {
      throw new HttpError('Project not found', 404);
    }
    return res.json({ message: 'Project deleted' });
  })
);

/**
 * GET /projects/:id/versions
 */
router.get(
  '/:id/versions',
  authenticateToken,
  asyncHandler(checkProjectEditorPermission),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const versions = await ProjectService.listVersions(id);
    return res.json(versions);
  })
);

/**
 * POST /projects/:id/versions
 */
router.post(
  '/:id/versions',
  authenticateToken,
  asyncHandler(checkProjectEditorPermission),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { project_data } = req.body || {};

    const newVersion = await ProjectService.createVersion(id, project_data);

    const session = SessionService.getSession(`project_${id}`);
    if (session) {
      SessionService.clearUndoRedo(session);
    }
    return res.status(201).json(newVersion);
  })
);

/**
 * POST /projects/:id/versions/:versionId/rollback
 */
router.post(
  '/:id/versions/:versionId/rollback',
  authenticateToken,
  asyncHandler(checkProjectEditorPermission),
  asyncHandler(async (req, res) => {
    const { id, versionId } = req.params;
    const result = await ProjectService.rollbackVersion(id, versionId);

    const session = SessionService.getSession(`project_${id}`);
    if (session) {
      SessionService.clearUndoRedo(session);
    }
    return res.json(result);
  })
);

export default router;

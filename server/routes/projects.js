// ./server/routes/projects.js
import express from "express";
import { authenticateToken } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/HttpError.js";
import { ProjectService } from "../services/ProjectService.js";
import { SessionService } from "../services/SessionService.js";

const router = express.Router();

/**
 * Middleware: Check if user can edit project (owner or admin).
 * Throws 403 if not authorized or project not found.
 */
async function authorizeProjectEditor(req, res, next) {
  const { id } = req.params; // e.g., /projects/:id
  const canEdit = await ProjectService.userCanEditProject(id, req.user);
  if (!canEdit) {
    throw new HttpError("Not authorized or project not found.", 403);
  }
  return next();
}

/**
 * GET /projects/ensureDefault
 */
router.get(
  "/ensureDefault",
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
  "/",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;
    if (!req.user || !req.user.id) {
      throw new HttpError("User ID is missing from request", 400);
    }

    if (!req.body.name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const project = await ProjectService.createProject(req.user.id, name, description);
    return res.status(201).json(project);
  })
);

/**
 * GET /projects
 */
router.get(
  "/",
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
  "/:id",
  authenticateToken,
  asyncHandler(authorizeProjectEditor),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    let { name, description } = req.body;
    if (!description) description = "";

    const updated = await ProjectService.updateProject(id, name, description);
    if (!updated) {
      throw new HttpError("Project not found", 404);
    }
    return res.json(updated);
  })
);

/**
 * DELETE /projects/:id
 */
router.delete(
  "/:id",
  authenticateToken,
  asyncHandler(authorizeProjectEditor),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const deleted = await ProjectService.deleteProject(id);
    if (!deleted) {
      throw new HttpError("Project not found", 404);
    }
    return res.json({ message: "Project deleted" });
  })
);

/**
 * GET /projects/:id/versions
 */
router.get(
  "/:id/versions",
  authenticateToken,
  asyncHandler(authorizeProjectEditor),
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
  "/:id/versions",
  authenticateToken,
  asyncHandler(authorizeProjectEditor),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { project_data } = req.body || {};

    const newVersion = await ProjectService.createVersion(id, project_data);

    // Invalidate the undo/redo stacks for the session(s) that reference this project
    // Example if your session code is "project_<id>"
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
  "/:id/versions/:versionId/rollback",
  authenticateToken,
  asyncHandler(authorizeProjectEditor),
  asyncHandler(async (req, res) => {
    const { id, versionId } = req.params;
    const result = await ProjectService.rollbackVersion(id, versionId);

    // Also clear the undo/redo for that project's session
    const session = SessionService.getSession(`project_${id}`);
    if (session) {
      SessionService.clearUndoRedo(session);
    }

    return res.json(result);
  })
);

export default router;

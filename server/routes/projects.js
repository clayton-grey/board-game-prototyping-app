// ./server/routes/projects.js

import express from "express";
import pool from "../database.js";
import { authenticateToken } from "../middleware/authMiddleware.js";
import config from "../config.js";

/**
 * Helper to determine if the request user is the project owner
 * or an admin. We'll use this for version endpoints as well.
 */
async function canEditProject(req, projectId) {
  // If user is admin, allow
  if (req.user && req.user.role === "admin") return true;
  // Otherwise check if user is the owner
  const result = await pool.query(
    "SELECT owner_id FROM projects WHERE id = $1",
    [projectId]
  );
  if (result.rows.length === 0) return false; // no such project
  const ownerId = result.rows[0].owner_id;
  return ownerId === req.user.id;
}

const router = express.Router();

// ------------------------------------------
// Standard Project CRUD
// ------------------------------------------

// Create a new project
router.post("/", authenticateToken, async (req, res) => {
  const { name, description } = req.body;

  if (!req.user || !req.user.id) {
    return res.status(400).json({ message: "User ID is missing from request" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *",
      [name, description, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all projects for the authenticated user (owner-only in this example)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM projects WHERE owner_id = $1",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update a project (e.g. rename)
router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  let { name, description } = req.body;

  try {
    // must be owner or admin
    const canEdit = await canEditProject(req, id);
    if (!canEdit) {
      return res.status(403).json({ message: "Not authorized." });
    }

    // If no description given, default to empty so query doesn't break
    if (!description) {
      description = "";
    }

    const result = await pool.query(
      "UPDATE projects SET name = $1, description = $2 WHERE id = $3 RETURNING *",
      [name, description, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Project not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete a project
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    // must be owner or admin
    const canEdit = await canEditProject(req, id);
    if (!canEdit) {
      return res.status(403).json({ message: "Not authorized." });
    }

    const result = await pool.query(
      "DELETE FROM projects WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Project not found" });
    }
    // Here you'd also forcibly invalidate sessions using this project, if needed.
    res.json({ message: "Project deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------------------------------
// NEW: Versioning Endpoints
// ------------------------------------------

router.get("/:id/versions", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const canEdit = await canEditProject(req, id);
    if (!canEdit) {
      return res.status(403).json({ message: "Not authorized." });
    }

    const result = await pool.query(
      `SELECT id, version_number, created_at
       FROM project_versions
       WHERE project_id = $1
       ORDER BY version_number DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error listing versions:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/versions", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { project_data } = req.body || {};

  try {
    const canEdit = await canEditProject(req, id);
    if (!canEdit) {
      return res.status(403).json({ message: "Not authorized." });
    }

    // find max version_number
    const maxVerResult = await pool.query(
      `SELECT COALESCE(MAX(version_number), 0) AS max_ver
       FROM project_versions
       WHERE project_id = $1`,
      [id]
    );
    const maxVer = maxVerResult.rows[0].max_ver || 0;
    const newVer = maxVer + 1;

    // Insert the new version row
    const insertResult = await pool.query(
      `INSERT INTO project_versions (project_id, version_number, project_data)
       VALUES ($1, $2, $3)
       RETURNING id, version_number, created_at`,
      [id, newVer, project_data || {}]
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    console.error("Error creating version:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/versions/:versionId/rollback", authenticateToken, async (req, res) => {
  const { id, versionId } = req.params;

  try {
    const canEdit = await canEditProject(req, id);
    if (!canEdit) {
      return res.status(403).json({ message: "Not authorized." });
    }

    // Load the old version to roll back to
    const oldVersionResult = await pool.query(
      `SELECT id, version_number, project_data
       FROM project_versions
       WHERE project_id = $1
         AND id = $2`,
      [id, versionId]
    );
    if (oldVersionResult.rows.length === 0) {
      return res.status(404).json({ message: "Version not found." });
    }

    const oldData = oldVersionResult.rows[0].project_data;

    // Then create a brand-new version row representing the rollback
    const maxVerResult = await pool.query(
      `SELECT COALESCE(MAX(version_number), 0) AS max_ver
       FROM project_versions
       WHERE project_id = $1`,
      [id]
    );
    const maxVer = maxVerResult.rows[0].max_ver || 0;
    const newVer = maxVer + 1;

    const rollbackInsert = await pool.query(
      `INSERT INTO project_versions (project_id, version_number, project_data)
       VALUES ($1, $2, $3)
       RETURNING id, version_number, created_at`,
      [id, newVer, oldData]
    );

    res.json({
      message: "Project rolled back successfully",
      newVersion: rollbackInsert.rows[0],
    });
  } catch (error) {
    console.error("Error rolling back project:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;

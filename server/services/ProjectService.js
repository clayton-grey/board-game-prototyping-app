// server/services/ProjectService.js
import pool from '../database.js';
import { HttpError } from '../utils/HttpError.js';

export class ProjectService {
  /**
   * Return all projects owned by a user.
   */
  static async getProjectsByOwner(userId) {
    const result = await pool.query(
      "SELECT * FROM projects WHERE owner_id = $1",
      [userId]
    );
    return result.rows;
  }

  /**
   * Create a new project for a given owner.
   */
  static async createProject(ownerId, name, description) {
    const result = await pool.query(
      "INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *",
      [name, description, ownerId]
    );
    return result.rows[0];
  }

  /**
   * Return the project's owner ID, or null if project doesn't exist.
   */
  static async getProjectOwnerId(projectId) {
    const result = await pool.query(
      "SELECT owner_id FROM projects WHERE id = $1",
      [projectId]
    );
    if (result.rows.length === 0) {
      return null; // no such project
    }
    return result.rows[0].owner_id;
  }

  /**
   * Update project name/description by ID. Returns updated row or null if not found.
   */
  static async updateProject(projectId, name, description) {
    const result = await pool.query(
      "UPDATE projects SET name = $1, description = $2 WHERE id = $3 RETURNING *",
      [name, description, projectId]
    );
    return result.rows[0] || null;
  }

  /**
   * Delete a project by ID. Returns the deleted row or null if not found.
   */
  static async deleteProject(projectId) {
    await pool.query('DELETE FROM project_versions WHERE project_id = $1', [projectId]);

    const result = await pool.query(
      "DELETE FROM projects WHERE id = $1 RETURNING *",
      [projectId]
    );
    return result.rows[0] || null;
  }

  /**
   * If the user doesn’t have any project, create a default. Return the default or existing project.
   */
  static async createDefaultProjectIfNone(userId) {
    const existing = await pool.query(
      "SELECT * FROM projects WHERE owner_id = $1 ORDER BY id LIMIT 1",
      [userId]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }
    // Otherwise create a new default
    const result = await pool.query(
      "INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *",
      ["My Default Project", "Auto-created for user", userId]
    );
    return result.rows[0];
  }

  /**
   * Return versions for a project, sorted descending by version_number.
   */
  static async listVersions(projectId) {
    const result = await pool.query(
      `SELECT id, version_number, created_at
       FROM project_versions
       WHERE project_id = $1
       ORDER BY version_number DESC`,
      [projectId]
    );
    return result.rows;
  }

  /**
   * Create a new version for the project, auto-incrementing version_number.
   */
  static async createVersion(projectId, projectData) {
    const maxVer = await this._getMaxVersionNumber(projectId);
    const newVer = maxVer + 1;

    const insertResult = await pool.query(
      `INSERT INTO project_versions (project_id, version_number, project_data)
       VALUES ($1, $2, $3)
       RETURNING id, version_number, created_at`,
      [projectId, newVer, projectData || {}]
    );
    return insertResult.rows[0];
  }

  /**
   * Rollback to a specific version => create a new version row with the old data.
   */
  static async rollbackVersion(projectId, versionId) {
    // Load the old version
    const oldVersionResult = await pool.query(
      `SELECT id, version_number, project_data
       FROM project_versions
       WHERE project_id = $1
         AND id = $2`,
      [projectId, versionId]
    );
    if (oldVersionResult.rows.length === 0) {
      throw new HttpError("Version not found.", 404);
    }
    const oldData = oldVersionResult.rows[0].project_data;

    // Then create a brand-new version row representing the rollback
    const maxVer = await this._getMaxVersionNumber(projectId);
    const newVer = maxVer + 1;

    const rollbackInsert = await pool.query(
      `INSERT INTO project_versions (project_id, version_number, project_data)
       VALUES ($1, $2, $3)
       RETURNING id, version_number, created_at`,
      [projectId, newVer, oldData]
    );

    return {
      message: "Project rolled back successfully",
      newVersion: rollbackInsert.rows[0],
    };
  }

  /**
   * Return true if the given user can edit the project (i.e., owns it or is admin).
   */
  static async userCanEditProject(projectId, user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    const ownerId = await this.getProjectOwnerId(projectId);
    if (!ownerId) return false;
    return ownerId === user.id;
  }

  /**
   * Internal helper: returns the current max version_number of a given project,
   * or 0 if no versions exist.
   */
  static async _getMaxVersionNumber(projectId) {
    const result = await pool.query(
      `SELECT COALESCE(MAX(version_number), 0) AS max_ver
       FROM project_versions
       WHERE project_id = $1`,
      [projectId]
    );
    return result.rows[0].max_ver || 0;
  }
}

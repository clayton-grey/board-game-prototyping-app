import express from "express";
import pool from "../database.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

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

// Get all projects for a user
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects WHERE owner_id = $1', [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update a project
router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    try {
        const result = await pool.query(
            'UPDATE projects SET name = $1, description = $2 WHERE id = $3 AND owner_id = $4 RETURNING *',
            [name, description, id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Project not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete a project
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM projects WHERE id = $1 AND owner_id = $2 RETURNING *', [id, req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Project not found' });
        res.json({ message: 'Project deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;

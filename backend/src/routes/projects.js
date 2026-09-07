const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const drive = require('../services/googleDrive');
const router = express.Router();
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.type, p.created_at,
            COUNT(r.id)::int AS release_count
     FROM projects p
     LEFT JOIN releases r ON r.project_id = p.id
     GROUP BY p.id
     ORDER BY p.name ASC`
  );
  res.json({ projects: rows });
});
// Admin only: add a new project
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, type } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required' });
  const projectType = type === 'app' ? 'app' : 'firmware';
  try {
    const { rows } = await pool.query(
      'INSERT INTO projects (name, type, created_by) VALUES ($1, $2, $3) RETURNING id, name, type, created_at',
      [name.trim(), projectType, req.user.id]
    );
    res.status(201).json({ project: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A project with that name already exists' });
    throw err;
  }
});

// Admin only: rename a project (type is intentionally not editable here)
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required' });
  try {
    const { rows } = await pool.query(
      'UPDATE projects SET name = $1 WHERE id = $2 RETURNING id, name, type, created_at',
      [name.trim(), id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json({ project: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A project with that name already exists' });
    throw err;
  }
});

// Admin only: delete a project — cleans up every release's Drive files first,
// then deletes the project row (release_stages and releases cascade via FK).
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { rows: projectRows } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
  const project = projectRows[0];
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { rows: releases } = await pool.query('SELECT * FROM releases WHERE project_id = $1', [id]);
  const fileIds = releases
    .flatMap((r) => [r.bin_file_id, r.zip_file_id, r.zip2_file_id, r.apk_file_id])
    .filter(Boolean);

  await Promise.all(
    fileIds.map((fileId) =>
      drive.deleteFile(fileId).catch((err) => {
        console.error(`Failed to delete Drive file ${fileId}:`, err.message);
      })
    )
  );

  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete project' });
  }

  res.json({ success: true });
});

module.exports = router;

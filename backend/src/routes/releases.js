const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { requireAuth, requireAdmin, hasPermission } = require('../middleware/auth');
const drive = require('../services/googleDrive');

const router = express.Router();

const STAGE_NAMES = {
  1: 'Firmware Team',
  2: 'QC Team',
  3: 'Kitchen Team',
  4: 'Sandy Sir',
};

const upload = multer({ dest: path.join(__dirname, '..', '..', 'tmp_uploads') });

function serializeRelease(release, stages, { canSeeFiles, user }) {
  return {
    id: release.id,
    project_id: release.project_id,
    version: release.version,
    note: release.note,
    overall_status: release.overall_status,
    created_by: release.created_by,
    created_at: release.created_at,
    release_date: release.release_date,
    approved_at: release.approved_at,
    bin_file_name: canSeeFiles ? release.bin_file_name : null,
    zip_file_name: canSeeFiles ? release.zip_file_name : null,
    zip2_file_name: canSeeFiles ? release.zip2_file_name : null,
    apk_file_name: canSeeFiles ? release.apk_file_name : null,
    files_available: canSeeFiles,
    stages: stages
      .sort((a, b) => a.stage_number - b.stage_number)
      .map((s) => ({
        stage_number: s.stage_number,
        stage_name: s.stage_name,
        status: s.status,
        remarks: s.remarks,
        updated_at: s.updated_at,
        can_update: user ? hasPermission(user, `stage_${s.stage_number}`) : false,
      })),
  };
}

function canSeeFilesFor(user, release) {
  return hasPermission(user, 'early_access') || release.overall_status === 'approved';
}

async function recomputeOverallStatus(releaseId, approvalDate) {
  const { rows } = await pool.query('SELECT status FROM release_stages WHERE release_id = $1', [releaseId]);
  let overall = 'pending';
  if (rows.some((r) => r.status === 'failed')) overall = 'rejected';
  else if (rows.length > 0 && rows.every((r) => r.status === 'passed')) overall = 'approved';
  await pool.query(
    `UPDATE releases
     SET overall_status = $1,
         approved_at = CASE WHEN $1 = 'approved' THEN COALESCE(approved_at, $3::timestamptz) ELSE NULL END
     WHERE id = $2`,
    [overall, releaseId, approvalDate || new Date()]
  );
  return overall;
}

// List releases for a project
router.get('/projects/:projectId/releases', requireAuth, async (req, res) => {
  const { projectId } = req.params;
  const { rows: releases } = await pool.query(
    'SELECT * FROM releases WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId]
  );
  if (releases.length === 0) return res.json({ releases: [] });

  const { rows: stages } = await pool.query(
    'SELECT * FROM release_stages WHERE release_id = ANY($1::int[])',
    [releases.map((r) => r.id)]
  );

  const result = releases.map((release) => {
    const canSeeFiles = canSeeFilesFor(req.user, release);
    return serializeRelease(
      release,
      stages.filter((s) => s.release_id === release.id),
      { canSeeFiles, user: req.user }
    );
  });
  res.json({ releases: result });
});

// Single release detail
router.get('/releases/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM releases WHERE id = $1', [req.params.id]);
  const release = rows[0];
  if (!release) return res.status(404).json({ error: 'Release not found' });

  const { rows: stages } = await pool.query('SELECT * FROM release_stages WHERE release_id = $1', [release.id]);
  const canSeeFiles = canSeeFilesFor(req.user, release);
  res.json({ release: serializeRelease(release, stages, { canSeeFiles, user: req.user }) });
});

// Admin: create a new release. Firmware projects upload .bin + optional .zip + optional Holtek .zip.
// App projects upload .zip + .apk.
router.post(
  '/projects/:projectId/releases',
  requireAuth,
  requireAdmin,
  upload.fields([
    { name: 'bin', maxCount: 1 },
    { name: 'zip', maxCount: 1 },
    { name: 'zip2', maxCount: 1 },
    { name: 'apk', maxCount: 1 },
  ]),
  async (req, res) => {
    const { projectId } = req.params;
    const { version, note, release_date } = req.body || {};
    const binFile = req.files?.bin?.[0] || null;
    const zipFile = req.files?.zip?.[0] || null;
    const zip2File = req.files?.zip2?.[0] || null;
    const apkFile = req.files?.apk?.[0] || null;

    const cleanup = () => {
      [binFile, zipFile, zip2File, apkFile].forEach((f) => {
        if (f) fs.unlink(f.path, () => {});
      });
    };

    if (!version || !version.trim()) {
      cleanup();
      return res.status(400).json({ error: 'Version is required' });
    }

    try {
      const { rows: projectRows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
      const project = projectRows[0];
      if (!project) {
        cleanup();
        return res.status(404).json({ error: 'Project not found' });
      }

      if (project.type === 'app') {
        if (!zipFile || !apkFile) {
          cleanup();
          return res.status(400).json({ error: 'Both a .zip file and a .apk file are required for app releases' });
        }
      } else {
        if (!binFile) {
          cleanup();
          return res.status(400).json({ error: 'A .bin file is required for firmware releases' });
        }
      }

      // Lazily create (or reuse) the project's Drive folder.
      let folderId = project.drive_folder_id;
      if (!folderId) {
        folderId = await drive.getOrCreateProjectFolder(project.name, process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
        await pool.query('UPDATE projects SET drive_folder_id = $1 WHERE id = $2', [folderId, project.id]);
      }

      const versionTag = version.trim().replace(/[^a-zA-Z0-9._-]/g, '_');

      let binUpload = null;
      if (binFile) {
        binUpload = await drive.uploadFile(
          binFile.path,
          `${versionTag}_${binFile.originalname}`,
          'application/octet-stream',
          folderId
        );
      }

      // Firmware/app zip is optional for firmware projects, required (checked above) for app projects.
      let zipUpload = null;
      if (zipFile) {
        zipUpload = await drive.uploadFile(
          zipFile.path,
          `${versionTag}_${zipFile.originalname}`,
          'application/zip',
          folderId
        );
      }

      // Holtek zip is optional — only upload it to Drive if it was actually attached.
      let zip2Upload = null;
      if (zip2File) {
        zip2Upload = await drive.uploadFile(
          zip2File.path,
          `${versionTag}_${zip2File.originalname}`,
          'application/zip',
          folderId
        );
      }

      let apkUpload = null;
      if (apkFile) {
        apkUpload = await drive.uploadFile(
          apkFile.path,
          `${versionTag}_${apkFile.originalname}`,
          'application/vnd.android.package-archive',
          folderId
        );
      }

      const { rows } = await pool.query(
        `INSERT INTO releases
           (project_id, version, note, release_date, bin_file_id, bin_file_name, zip_file_id, zip_file_name, zip2_file_id, zip2_file_name, apk_file_id, apk_file_name, created_by)
         VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          projectId,
          version.trim(),
          note || null,
          release_date || null,
          binUpload ? binUpload.id : null,
          binUpload ? binUpload.name : null,
          zipUpload ? zipUpload.id : null,
          zipUpload ? zipUpload.name : null,
          zip2Upload ? zip2Upload.id : null,
          zip2Upload ? zip2Upload.name : null,
          apkUpload ? apkUpload.id : null,
          apkUpload ? apkUpload.name : null,
          req.user.id,
        ]
      );
      const release = rows[0];

      const stageInserts = [1, 2, 3, 4].map((num) =>
        pool.query(
          'INSERT INTO release_stages (release_id, stage_number, stage_name) VALUES ($1, $2, $3)',
          [release.id, num, STAGE_NAMES[num]]
        )
      );
      await Promise.all(stageInserts);

      cleanup();
      const { rows: stages } = await pool.query('SELECT * FROM release_stages WHERE release_id = $1', [release.id]);
      res.status(201).json({ release: serializeRelease(release, stages, { canSeeFiles: true, user: req.user }) });
    } catch (err) {
      cleanup();
      console.error(err);
      res.status(500).json({ error: 'Failed to create release. Check Google Drive configuration.' });
    }
  }
);

// Update one approval stage (pass/fail + remarks) — admin, or a user granted that specific stage
router.patch('/releases/:id/stages/:stageNumber', requireAuth, async (req, res) => {
  const { id, stageNumber } = req.params;
  const { status, remarks, date } = req.body || {};

  if (!hasPermission(req.user, `stage_${stageNumber}`)) {
    return res.status(403).json({ error: 'You do not have permission to update this approval stage' });
  }
  if (!['passed', 'failed', 'pending'].includes(status)) {
    return res.status(400).json({ error: "status must be 'passed', 'failed' or 'pending'" });
  }
  let updatedAt = new Date();
  if (date) {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid date' });
    updatedAt = parsed;
  }

  const { rowCount } = await pool.query(
    `UPDATE release_stages
     SET status = $1, remarks = $2, updated_by = $3, updated_at = $4
     WHERE release_id = $5 AND stage_number = $6`,
    [status, remarks || null, req.user.id, updatedAt, id, stageNumber]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Stage not found' });

  const overall_status = await recomputeOverallStatus(id, updatedAt);
  const { rows: stages } = await pool.query('SELECT * FROM release_stages WHERE release_id = $1', [id]);
  res.json({ overall_status, stages });
});

// Admin: delete a release — removes the Drive files and the DB rows (stages first, then the release)
router.delete('/releases/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { rows } = await pool.query('SELECT * FROM releases WHERE id = $1', [id]);
  const release = rows[0];
  if (!release) return res.status(404).json({ error: 'Release not found' });

  // Best-effort Drive cleanup — a failed/missing file shouldn't block deleting the record.
  const fileIds = [release.bin_file_id, release.zip_file_id, release.zip2_file_id, release.apk_file_id].filter(
    Boolean
  );
  await Promise.all(
    fileIds.map((fileId) =>
      drive.deleteFile(fileId).catch((err) => {
        console.error(`Failed to delete Drive file ${fileId}:`, err.message);
      })
    )
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM release_stages WHERE release_id = $1', [id]);
    await client.query('DELETE FROM releases WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete release' });
  } finally {
    client.release();
  }

  res.json({ success: true });
});

// Download the bin, zip, zip2 (Holtek), or apk file — only once the release is fully approved (or if admin)
router.get('/releases/:id/download/:fileType', requireAuth, async (req, res) => {
  const { id, fileType } = req.params;
  if (!['bin', 'zip', 'zip2', 'apk'].includes(fileType)) {
    return res.status(400).json({ error: 'fileType must be bin, zip, zip2, or apk' });
  }

  const { rows } = await pool.query('SELECT * FROM releases WHERE id = $1', [id]);
  const release = rows[0];
  if (!release) return res.status(404).json({ error: 'Release not found' });

  const canDownload = canSeeFilesFor(req.user, release);
  if (!canDownload) return res.status(403).json({ error: 'This release has not completed approval yet' });

  const fileIdMap = {
    bin: release.bin_file_id,
    zip: release.zip_file_id,
    zip2: release.zip2_file_id,
    apk: release.apk_file_id,
  };
  const fileId = fileIdMap[fileType];
  if (!fileId) return res.status(404).json({ error: 'File not found' });

  // Map each file type to its DB name field, forced extension and MIME type so a
  // file is always downloaded with the correct extension (a .apk can never be
  // served as a .exe regardless of what Google Drive stored).
  const fileTypeConfig = {
    bin: { nameField: 'bin_file_name', ext: 'bin', contentType: 'application/octet-stream' },
    zip: { nameField: 'zip_file_name', ext: 'zip', contentType: 'application/zip' },
    zip2: { nameField: 'zip2_file_name', ext: 'zip', contentType: 'application/zip' },
    apk: { nameField: 'apk_file_name', ext: 'apk', contentType: 'application/vnd.android.package-archive' },
  };
  const config = fileTypeConfig[fileType];
  const storedName = release[config.nameField] || `${release.version}.${config.ext}`;
  // Strip any existing extension, then force ours.
  const downloadName = `${storedName.replace(/\.[^.]*$/, '') || release.version}.${config.ext}`;

  try {
    await drive.pipeFileToResponse(fileId, res, {
      downloadName,
      contentType: config.contentType,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch file from Google Drive' });
  }
});

module.exports = router;

const fs = require('fs');
const { google } = require('googleapis');
const SCOPES = ['https://www.googleapis.com/auth/drive'];
/**
 * Two supported auth modes:
 *  - OAuth as a personal Google account (works with any @gmail.com account,
 *    uploads count against that account's normal Drive storage). Used when
 *    GOOGLE_OAUTH_REFRESH_TOKEN is set.
 *  - Service account (requires a Google Workspace Shared Drive, since bare
 *    service accounts have 0 storage quota of their own). Used as a fallback
 *    when GOOGLE_SERVICE_ACCOUNT_KEY_FILE / _JSON is set instead.
 */
function buildAuth() {
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:53682/oauth2callback'
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
    return oauth2Client;
  }
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON);
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, 'utf8'));
  } else {
    throw new Error(
      'No Google credentials configured. Set GOOGLE_OAUTH_REFRESH_TOKEN (personal account) or ' +
        'GOOGLE_SERVICE_ACCOUNT_KEY_FILE / GOOGLE_SERVICE_ACCOUNT_KEY_JSON (Workspace service account).'
    );
  }
  return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
}
let _drive = null;
function getDrive() {
  if (_drive) return _drive;
  _drive = google.drive({ version: 'v3', auth: buildAuth() });
  return _drive;
}
/** Find an existing sub-folder by name under parentId, or create it. Returns the folder ID. */
async function getOrCreateProjectFolder(projectName, parentId) {
  const drive = getDrive();
  const safeName = projectName.replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const existing = await drive.files.list({
    q,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id;
  }
  const created = await drive.files.create({
    requestBody: {
      name: projectName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}
/** Upload a local file to a Drive folder. Returns { id, name, webViewLink }. */
async function uploadFile(localPath, fileName, mimeType, parentFolderId) {
  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [parentFolderId] },
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return res.data;
}
/** Stream a Drive file's bytes directly into an Express response. */
async function pipeFileToResponse(fileId, res) {
  const drive = getDrive();
  const meta = await drive.files.get({
    fileId,
    fields: 'name, mimeType, size',
    supportsAllDrives: true,
  });
  const stream = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  res.setHeader('Content-Disposition', `attachment; filename="${meta.data.name}"`);
  res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
  stream.data.pipe(res);
}
/** Delete a file from Drive by its file ID. Safe to call even if already gone. */
async function deleteFile(fileId) {
  if (!fileId) return;
  const drive = getDrive();
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (err) {
    // 404 just means it's already gone — treat as success either way.
    if (err.code !== 404) throw err;
  }
}
module.exports = { getOrCreateProjectFolder, uploadFile, pipeFileToResponse, deleteFile };

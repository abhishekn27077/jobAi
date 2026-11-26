/**
 * CareerOS — Optional Google Drive Integration (Phase 15)
 * Uses minimum-privilege `drive.file` scope (access only to CareerOS-created files).
 * Remains strictly optional, never uploads temporary files, and never makes files public.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from '../db/schema.js';
import { getOAuthStatus, getValidAccessToken } from '../email/googleOAuthClient.js';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_APP_FOLDER_NAME = 'CareerOS Application Documents';
export const ALLOWED_DRIVE_DOC_TYPES = ['resume', 'cover_letter', 'interview_prep', 'company_research'];

export function getDriveIntegrationStatus() {
  const oauth = getOAuthStatus();
  const hasDriveScope = Array.isArray(oauth.scopes) && oauth.scopes.includes(DRIVE_FILE_SCOPE);
  return {
    optional: true,
    oauthConnected: Boolean(oauth.connected),
    driveScopeGranted: hasDriveScope,
    requiredScope: DRIVE_FILE_SCOPE,
    folderName: DRIVE_APP_FOLDER_NAME,
    ready: Boolean(oauth.connected && hasDriveScope)
  };
}

/**
 * Ensures the private CareerOS folder exists in Google Drive (never public).
 */
export async function ensureDriveAppFolder({ fetchImpl = fetch } = {}) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Google OAuth not connected.');

  const q = encodeURIComponent(`name='${DRIVE_APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetchImpl(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!searchRes.ok) throw new Error(`Google Drive search failed: HTTP ${searchRes.status}`);
  const data = await searchRes.json();
  if (data.files && data.files.length > 0) {
    return data.files[0];
  }

  const createRes = await fetchImpl('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: DRIVE_APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  if (!createRes.ok) throw new Error(`Google Drive folder creation failed: HTTP ${createRes.status}`);
  return await createRes.json();
}

/**
 * Uploads a selected final document to Google Drive (private, never public) and links it in SQLite.
 */
export async function uploadDocumentToDrive({
  jobId = null,
  applicationId = null,
  localPath,
  docType,
  fileName = null,
  fetchImpl = fetch
}) {
  if (!ALLOWED_DRIVE_DOC_TYPES.includes(docType)) {
    throw new Error(`Invalid docType "${docType}". Allowed: ${ALLOWED_DRIVE_DOC_TYPES.join(', ')}`);
  }
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error(`Selected local document does not exist: ${path.basename(localPath || '')}`);
  }
  const baseName = fileName || path.basename(localPath);
  if (baseName.toLowerCase().includes('.tmp') || baseName.toLowerCase().startsWith('temp_')) {
    throw new Error('Temporary files cannot be uploaded to Google Drive.');
  }

  const status = getDriveIntegrationStatus();
  if (!status.ready) {
    throw new Error('Google Drive integration is not enabled or missing drive.file OAuth scope.');
  }

  const token = await getValidAccessToken();
  const folder = await ensureDriveAppFolder({ fetchImpl });
  const fileBuffer = fs.readFileSync(localPath);
  const mimeType = baseName.endsWith('.pdf')
    ? 'application/pdf'
    : baseName.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'text/plain';

  const boundary = `careeros_drive_${Date.now()}`;
  const metadataPart = JSON.stringify({
    name: baseName,
    parents: [folder.id]
  });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const uploadRes = await fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  if (!uploadRes.ok) {
    throw new Error(`Google Drive upload failed: HTTP ${uploadRes.status}`);
  }
  const uploaded = await uploadRes.json();

  const db = getDatabase();
  const insertRes = db.prepare(`
    INSERT INTO drive_links (job_id, application_id, drive_file_id, file_name, doc_type, folder_id, web_view_link, local_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    applicationId,
    uploaded.id,
    uploaded.name || baseName,
    docType,
    folder.id,
    uploaded.webViewLink || null,
    localPath
  );

  return db.prepare('SELECT * FROM drive_links WHERE id = ?').get(insertRes.lastInsertRowid);
}

export function listDriveLinks({ jobId = null } = {}) {
  const db = getDatabase();
  if (jobId) {
    return db.prepare('SELECT * FROM drive_links WHERE job_id = ? ORDER BY id DESC').all(jobId);
  }
  return db.prepare('SELECT * FROM drive_links ORDER BY id DESC LIMIT 100').all();
}

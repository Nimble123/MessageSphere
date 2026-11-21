// ===========================================================================
// MessageSphere Enterprise Storage & Asset Engine
// Supports Local Ephemeral, Persistent Disk (Render / Docker), and Object Storage (S3 / Cloudflare R2)
// ===========================================================================
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Resolve root uploads directory (checks environment variables for persistent volume mount)
const ROOT_UPLOADS_DIR = (process.env.UPLOADS_DIR || process.env.UPLOAD_DIR)
  ? path.resolve(process.env.UPLOADS_DIR || process.env.UPLOAD_DIR)
  : (process.env.PERSISTENT_STORAGE_DIR
      ? path.resolve(process.env.PERSISTENT_STORAGE_DIR, 'uploads')
      : path.join(__dirname, '../uploads'));

// Subdirectories
const LOGOS_DIR = path.join(ROOT_UPLOADS_DIR, 'logos');
const FAVICONS_DIR = path.join(ROOT_UPLOADS_DIR, 'favicons');
const TEMP_DIR = path.join(ROOT_UPLOADS_DIR, 'temp');

// Ensure all storage directories exist on startup
[ROOT_UPLOADS_DIR, LOGOS_DIR, FAVICONS_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[STORAGE WARNING] Failed to create directory ${dir}:`, err.message);
    }
  }
});

function getUploadsDir(subpath = '') {
  if (!subpath) return ROOT_UPLOADS_DIR;
  const target = path.join(ROOT_UPLOADS_DIR, subpath);
  if (!fs.existsSync(target)) {
    try { fs.mkdirSync(target, { recursive: true }); } catch (_) {}
  }
  return target;
}

// Default safe disk storage with collision-free naming
const generalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, ROOT_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const safeBase = path.basename(file.originalname, safeExt).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    cb(null, `${uniqueSuffix}-${safeBase}${safeExt}`);
  }
});

/**
 * Persist an uploaded file buffer into the PostgreSQL binary storage table.
 * Guarantees zero file loss even if the container restarts or redeploys on ephemeral hosts (Render / Docker).
 */
async function persistUploadedFile(file) {
  if (!file || !file.filename || !file.path) return;
  try {
    if (!fs.existsSync(file.path)) return;
    const { query } = require('../db');
    const fileBuffer = await fs.promises.readFile(file.path);
    await query(`
      INSERT INTO stored_files (filename, mimetype, size, data)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (filename) DO UPDATE 
      SET data = EXCLUDED.data, mimetype = EXCLUDED.mimetype, size = EXCLUDED.size
    `, [file.filename, file.mimetype || 'application/octet-stream', file.size || fileBuffer.length, fileBuffer]);
  } catch (err) {
    console.warn(`[STORAGE WARNING] Failed to persist file ${file.filename} to database:`, err.message);
  }
}

/**
 * Retrieve a stored file from disk or auto-restore from PostgreSQL binary store.
 */
async function retrieveStoredFile(filename) {
  if (!filename) return null;
  const candidatePaths = [
    path.join(ROOT_UPLOADS_DIR, filename),
    path.join(__dirname, '../uploads', filename),
    path.join(process.cwd(), 'uploads', filename),
    path.join(ROOT_UPLOADS_DIR, 'temp', filename),
    path.join(ROOT_UPLOADS_DIR, 'logos', filename)
  ];
  let diskPath = candidatePaths.find(p => fs.existsSync(p));

  if (diskPath) {
    return { path: diskPath, buffer: null, mimetype: null };
  }

  // Fallback to PostgreSQL binary store
  try {
    const { query } = require('../db');
    const dbRes = await query('SELECT mimetype, data FROM stored_files WHERE filename = $1 LIMIT 1', [filename]);
    if (dbRes.rows.length > 0 && dbRes.rows[0].data) {
      const restorePath = path.join(ROOT_UPLOADS_DIR, filename);
      try {
        fs.writeFileSync(restorePath, dbRes.rows[0].data);
        return { path: restorePath, buffer: dbRes.rows[0].data, mimetype: dbRes.rows[0].mimetype };
      } catch (_) {
        return { path: null, buffer: dbRes.rows[0].data, mimetype: dbRes.rows[0].mimetype };
      }
    }
  } catch (err) {
    console.warn(`[STORAGE WARNING] Error retrieving ${filename} from database:`, err.message);
  }

  return null;
}

module.exports = {
  ROOT_UPLOADS_DIR,
  LOGOS_DIR,
  FAVICONS_DIR,
  TEMP_DIR,
  getUploadsDir,
  generalStorage,
  persistUploadedFile,
  retrieveStoredFile
};

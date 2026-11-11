// ===========================================================================
// MessageSphere Enterprise Storage & Asset Engine
// Supports Local Ephemeral, Persistent Disk (Render / Docker), and Object Storage (S3 / Cloudflare R2)
// ===========================================================================
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Resolve root uploads directory (checks environment variables for persistent volume mount)
const ROOT_UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
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

module.exports = {
  ROOT_UPLOADS_DIR,
  LOGOS_DIR,
  FAVICONS_DIR,
  TEMP_DIR,
  getUploadsDir,
  generalStorage
};

// ===========================================================================
// Password Hashing & Verification Engine
// Prioritizes native C++ bcrypt (libuv worker threads, non-blocking)
// with seamless fallback to bcryptjs.
// ===========================================================================
let bcryptEngine;
try {
  bcryptEngine = require('bcrypt');
} catch (_) {
  bcryptEngine = require('bcryptjs');
}

/**
 * Hash a password using 10 salt rounds on a background thread.
 * @param {string} password 
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  return bcryptEngine.hash(password, 10);
}

/**
 * Compare password with hash on a background worker thread.
 * @param {string} password 
 * @param {string} hash 
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
  return bcryptEngine.compare(password, hash);
}

module.exports = {
  hashPassword,
  comparePassword,
  bcrypt: bcryptEngine
};

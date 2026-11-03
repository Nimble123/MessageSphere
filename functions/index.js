// This portal uses the Node.js/PostgreSQL application in the repository root.
// The former Firebase function accepted credentials through Firestore and created
// a second, disconnected identity store. It is intentionally disabled so there
// is one authoritative user-management path: POST /api/users on the main server.
module.exports = {};

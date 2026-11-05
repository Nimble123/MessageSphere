const { query: defaultQuery } = require('../db');

async function logAudit(client, { actorId, entityType, entityId = null, action, details = {} }) {
  const executor = client && typeof client.query === 'function' ? client.query.bind(client) : defaultQuery;
  try {
    await executor(
      `INSERT INTO audit_events (actor_id, entity_type, entity_id, action, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [actorId || null, entityType, entityId, action, JSON.stringify(details || {})]
    );
  } catch (err) {
    console.error('[AUDIT LOG ERROR]:', err.message);
  }
}

module.exports = { logAudit };

async function logAudit(client, { actorId, entityType, entityId = null, action, details = {} }) {
  await client.query(
    `INSERT INTO audit_events (actor_id, entity_type, entity_id, action, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorId || null, entityType, entityId, action, JSON.stringify(details)]
  );
}

module.exports = { logAudit };

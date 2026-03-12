import { pool } from '../config/db.js';

export async function writeAuditLog({ tenantId = null, userId = null, action, entityType, entityId = null, details = {}, ipAddress = null, userAgent = null }) {
  await pool.query(
    `insert into audit_logs (tenant_id, user_id, action, entity_type, entity_id, details, ip_address, user_agent)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
    [tenantId, userId, action, entityType, entityId, JSON.stringify(details || {}), ipAddress, userAgent]
  );
}

import { pool } from '../config/db.js';
import { emitTenantEvent } from './realtimeService.js';
import { writeAuditLog } from './auditService.js';

export async function listInbox(tenantId) {
  const { rows } = await pool.query(
    `select c.*, u.full_name as agent_name,
       (select count(*) from messages m where m.conversation_id = c.id) as message_count
     from conversations c
     left join users u on u.id = c.assigned_agent_id
     where c.tenant_id = $1
     order by case c.priority when 'critical' then 1 when 'high' then 2 else 3 end, c.updated_at desc`,
    [tenantId]
  );
  return rows;
}

export async function getConversation(tenantId, conversationId) {
  const convRes = await pool.query(
    `select c.*, u.full_name as agent_name
     from conversations c
     left join users u on u.id = c.assigned_agent_id
     where c.tenant_id = $1 and c.id = $2`,
    [tenantId, conversationId]
  );
  const msgRes = await pool.query(
    `select m.*, a.id as attachment_id, a.original_name, a.mime_type, a.storage_path, a.file_size
     from messages m
     left join attachments a on a.message_id = m.id
     where m.tenant_id = $1 and m.conversation_id = $2
     order by m.created_at asc`,
    [tenantId, conversationId]
  );
  return { conversation: convRes.rows[0], messages: msgRes.rows };
}

export async function addMessage({ tenantId, conversationId, senderType, body, userId = null, attachment = null, reqMeta = {} }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const msgRes = await client.query(
      `insert into messages (conversation_id, tenant_id, sender_type, body)
       values ($1,$2,$3,$4)
       returning *`,
      [conversationId, tenantId, senderType, body]
    );
    const message = msgRes.rows[0];

    if (attachment) {
      await client.query(
        `insert into attachments (tenant_id, conversation_id, message_id, original_name, mime_type, file_size, storage_path, created_by_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, conversationId, message.id, attachment.originalname, attachment.mimetype, attachment.size, attachment.path.replace('src/public', '/public'), userId]
      );
    }

    await client.query(
      `update conversations
       set last_message = $3,
           updated_at = now(),
           status = case when status = 'closed' then 'assigned' else status end,
           first_response_at = case when $4 = 'agent' and first_response_at is null then now() else first_response_at end
       where id = $1 and tenant_id = $2`,
      [conversationId, tenantId, body, senderType]
    );

    await client.query('commit');
    emitTenantEvent(tenantId, 'conversation:message', { conversationId, message: { ...message, body } });
    await writeAuditLog({ tenantId, userId, action: 'message.created', entityType: 'conversation', entityId: conversationId, details: { senderType, body }, ...reqMeta });
    return message;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function assignConversation({ tenantId, conversationId, toUserId, fromUserId = null, reqMeta = {} }) {
  await pool.query(
    `update conversations
     set assigned_agent_id = $3, status = 'assigned', waiting_since = null, updated_at = now()
     where tenant_id = $1 and id = $2`,
    [tenantId, conversationId, toUserId]
  );
  await pool.query(
    `insert into conversation_queue_events (tenant_id, conversation_id, event_type, from_user_id, to_user_id)
     values ($1,$2,'assigned',$3,$4)`,
    [tenantId, conversationId, fromUserId, toUserId]
  );
  emitTenantEvent(tenantId, 'conversation:assigned', { conversationId, toUserId });
  await writeAuditLog({ tenantId, userId: fromUserId, action: 'conversation.assigned', entityType: 'conversation', entityId: conversationId, details: { toUserId }, ...reqMeta });
}

export async function moveToQueue({ tenantId, conversationId, fromUserId = null, priority = 'normal', reqMeta = {} }) {
  await pool.query(
    `update conversations
     set status = 'waiting_human', priority = $3, assigned_agent_id = null, waiting_since = now(), updated_at = now()
     where tenant_id = $1 and id = $2`,
    [tenantId, conversationId, priority]
  );
  await pool.query(
    `insert into conversation_queue_events (tenant_id, conversation_id, event_type, from_user_id, note)
     values ($1,$2,'queued',$3,$4)`,
    [tenantId, conversationId, fromUserId, `priority:${priority}`]
  );
  emitTenantEvent(tenantId, 'conversation:queued', { conversationId, priority });
  await writeAuditLog({ tenantId, userId: fromUserId, action: 'conversation.queued', entityType: 'conversation', entityId: conversationId, details: { priority }, ...reqMeta });
}

export async function closeConversation({ tenantId, conversationId, userId, reqMeta = {} }) {
  await pool.query(
    `update conversations set status = 'closed', closed_at = now(), updated_at = now() where tenant_id = $1 and id = $2`,
    [tenantId, conversationId]
  );
  emitTenantEvent(tenantId, 'conversation:closed', { conversationId });
  await writeAuditLog({ tenantId, userId, action: 'conversation.closed', entityType: 'conversation', entityId: conversationId, details: {}, ...reqMeta });
}

export async function upsertInboundConversation({ tenantId, contactPhone, contactName = null, body, reqMeta = {} }) {
  const existing = await pool.query(
    `select id from conversations where tenant_id = $1 and contact_phone = $2 and status <> 'closed' order by updated_at desc limit 1`,
    [tenantId, contactPhone]
  );
  let conversationId = existing.rows[0]?.id;
  if (!conversationId) {
    const convRes = await pool.query(
      `insert into conversations (tenant_id, contact_name, contact_phone, status, waiting_since, last_message)
       values ($1,$2,$3,'bot_active', now(), $4)
       returning id`,
      [tenantId, contactName, contactPhone, body]
    );
    conversationId = convRes.rows[0].id;
  }
  await addMessage({ tenantId, conversationId, senderType: 'contact', body, reqMeta });
  return conversationId;
}

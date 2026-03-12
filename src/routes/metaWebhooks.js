import express from 'express';
import { pool } from '../config/db.js';
import { handleBotForInbound } from '../services/botService.js';
import { upsertInboundConversation } from '../services/conversationService.js';

const router = express.Router();

function extractMessages(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const messages = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const inbound = Array.isArray(value?.messages) ? value.messages : [];
      for (const item of inbound) messages.push(item);
    }
  }

  return messages;
}

function getMessageBody(item) {
  if (item?.text?.body) return item.text.body;
  if (item?.interactive?.button_reply?.title) return item.interactive.button_reply.title;
  if (item?.interactive?.list_reply?.title) return item.interactive.list_reply.title;
  if (item?.button?.text) return item.button.text;
  if (item?.type === 'audio') return '[áudio recebido]';
  if (item?.type === 'image') return '[imagem recebida]';
  if (item?.type === 'document') return `[documento recebido] ${item.document?.filename || ''}`.trim();
  return '[mensagem sem texto]';
}

router.get('/webhooks/meta/:slug', async (req, res) => {
  const { slug } = req.params;
  const { 'hub.mode': mode, 'hub.verify_token': verifyToken, 'hub.challenge': challenge } = req.query;
  const { rows } = await pool.query('select meta_verify_token from tenants where slug = $1', [slug]);
  if (mode === 'subscribe' && rows[0]?.meta_verify_token === verifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

router.post('/webhooks/meta/:slug', async (req, res) => {
  const { slug } = req.params;
  const { rows } = await pool.query('select id from tenants where slug = $1', [slug]);
  const tenant = rows[0];
  if (!tenant) return res.sendStatus(404);

  const messages = extractMessages(req.body);
  for (const item of messages) {
    if (!item?.from) continue;
    const phone = item.from;
    const body = getMessageBody(item);
    const { conversationId, protocolCode } = await upsertInboundConversation({
      tenantId: tenant.id,
      contactPhone: phone,
      body,
      reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] }
    });

    try {
      await handleBotForInbound({
        tenantId: tenant.id,
        conversationId,
        contactPhone: phone,
        body,
        protocolCode,
        reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] }
      });
    } catch (error) {
      await pool.query(
        `insert into outbound_failures (tenant_id, conversation_id, payload, error_message)
         values ($1,$2,$3::jsonb,$4)`,
        [tenant.id, conversationId, JSON.stringify({ source: 'bot_webhook', phone, body }), error.message]
      );
    }
  }

  res.sendStatus(200);
});

router.post('/simulate/inbound/:slug', async (req, res) => {
  const { slug } = req.params;
  const { phone, body, name } = req.body;
  const { rows } = await pool.query('select id from tenants where slug = $1', [slug]);
  if (!rows[0]) return res.status(404).json({ error: 'tenant not found' });
  const { conversationId, protocolCode } = await upsertInboundConversation({
    tenantId: rows[0].id,
    contactPhone: phone,
    contactName: name,
    body,
    reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] }
  });

  try {
    await handleBotForInbound({
      tenantId: rows[0].id,
      conversationId,
      contactPhone: phone,
      body,
      protocolCode,
      reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] }
    });
  } catch (error) {
    await pool.query(
      `insert into outbound_failures (tenant_id, conversation_id, payload, error_message)
       values ($1,$2,$3::jsonb,$4)`,
      [rows[0].id, conversationId, JSON.stringify({ source: 'simulate_inbound', phone, body }), error.message]
    );
  }

  res.json({ ok: true, conversationId, protocolCode });
});

export default router;

import express from 'express';
import { pool } from '../config/db.js';
import { moveToQueue, upsertInboundConversation } from '../services/conversationService.js';

const router = express.Router();

router.get('/webhooks/meta/:slug', async (req, res) => {
  const { slug } = req.params;
  const { 'hub.mode': mode, 'hub.verify_token': verifyToken, 'hub.challenge': challenge } = req.query;
  const { rows } = await pool.query('select meta_verify_token from tenants where slug = $1', [slug]);
  if (mode === 'subscribe' && rows[0]?.meta_verify_token === verifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

router.post('/webhooks/meta/:slug', async (req, res) => {
  const { slug } = req.params;
  const { rows } = await pool.query('select id, bot_flow_json from tenants where slug = $1', [slug]);
  const tenant = rows[0];
  if (!tenant) return res.sendStatus(404);

  const changes = req.body?.entry?.[0]?.changes?.[0]?.value?.messages || [];
  for (const item of changes) {
    const phone = item.from;
    const body = item.text?.body || '[mensagem sem texto]';
    const conversationId = await upsertInboundConversation({ tenantId: tenant.id, contactPhone: phone, body, reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });

    const flow = tenant.bot_flow_json || {};
    if (String(body).trim() === '4' || /atendente|humano/i.test(body)) {
      await moveToQueue({ tenantId: tenant.id, conversationId, priority: 'high' });
    }
  }
  res.sendStatus(200);
});

router.post('/simulate/inbound/:slug', async (req, res) => {
  const { slug } = req.params;
  const { phone, body, name } = req.body;
  const { rows } = await pool.query('select id from tenants where slug = $1', [slug]);
  if (!rows[0]) return res.status(404).json({ error: 'tenant not found' });
  const conversationId = await upsertInboundConversation({ tenantId: rows[0].id, contactPhone: phone, contactName: name, body, reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });
  res.json({ ok: true, conversationId });
});

export default router;

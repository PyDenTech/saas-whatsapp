import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { addMessage, assignConversation, closeConversation, getConversation, listInbox, moveToQueue } from '../services/conversationService.js';
import { sendWhatsAppText } from '../services/metaWhatsAppService.js';

const router = express.Router();
const uploadDir = path.resolve(env.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 }, dest: uploadDir });

router.get('/conversations', requireAuth, async (req, res) => {
  const tenantId = res.locals.currentUser.tenant_id;
  const conversations = await listInbox(tenantId);
  const selectedId = req.query.id || conversations[0]?.id || null;
  const selected = selectedId ? await getConversation(tenantId, selectedId) : { conversation: null, messages: [] };
  const agentsRes = await pool.query('select id, full_name from users where tenant_id = $1 and is_active = true order by full_name asc', [tenantId]);
  res.render('conversations/index', {
    title: 'Conversas',
    conversations,
    selected: selected.conversation,
    messages: selected.messages,
    agents: agentsRes.rows
  });
});

router.post('/conversations/:id/message', requireAuth, upload.single('attachment'), async (req, res) => {
  const currentUser = res.locals.currentUser;
  const conversationId = req.params.id;
  const body = req.body.body?.trim() || (req.file ? `[Anexo] ${req.file.originalname}` : '');
  await addMessage({ tenantId: currentUser.tenant_id, conversationId, senderType: 'agent', body, userId: currentUser.id, attachment: req.file, reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });

  if (req.body.send_to_whatsapp === '1') {
    const { rows } = await pool.query('select contact_phone from conversations where tenant_id = $1 and id = $2', [currentUser.tenant_id, conversationId]);
    try {
      await sendWhatsAppText({ tenantId: currentUser.tenant_id, to: rows[0].contact_phone, body });
    } catch (error) {
      await pool.query('insert into outbound_failures (tenant_id, conversation_id, payload, error_message) values ($1,$2,$3::jsonb,$4)', [currentUser.tenant_id, conversationId, JSON.stringify({ body }), error.message]);
    }
  }
  res.redirect(`/conversations?id=${conversationId}`);
});

router.post('/conversations/:id/assign', requireAuth, async (req, res) => {
  const currentUser = res.locals.currentUser;
  await assignConversation({ tenantId: currentUser.tenant_id, conversationId: req.params.id, toUserId: req.body.user_id, fromUserId: currentUser.id, reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });
  res.redirect(`/conversations?id=${req.params.id}`);
});

router.post('/conversations/:id/queue', requireAuth, async (req, res) => {
  const currentUser = res.locals.currentUser;
  await moveToQueue({ tenantId: currentUser.tenant_id, conversationId: req.params.id, fromUserId: currentUser.id, priority: req.body.priority || 'normal', reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });
  res.redirect(`/conversations?id=${req.params.id}`);
});

router.post('/conversations/:id/close', requireAuth, async (req, res) => {
  const currentUser = res.locals.currentUser;
  await closeConversation({ tenantId: currentUser.tenant_id, conversationId: req.params.id, userId: currentUser.id, reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });
  res.redirect('/conversations');
});

export default router;

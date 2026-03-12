import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { addMessage, assignConversation, closeConversation, getConversation, listInbox, moveToQueue } from '../services/conversationService.js';
import { sendWhatsAppText } from '../services/metaWhatsAppService.js';
import { autoAssignConversation } from '../services/botService.js';

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
    agents: agentsRes.rows,
    feedback: {
      type: req.query.feedback_type || null,
      message: req.query.feedback || null
    }
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
      return res.redirect(`/conversations?id=${conversationId}&feedback_type=success&feedback=${encodeURIComponent('Mensagem enviada para o WhatsApp com sucesso.')}`);
    } catch (error) {
      await pool.query('insert into outbound_failures (tenant_id, conversation_id, payload, error_message) values ($1,$2,$3::jsonb,$4)', [currentUser.tenant_id, conversationId, JSON.stringify({ body }), error.message]);
      return res.redirect(`/conversations?id=${conversationId}&feedback_type=error&feedback=${encodeURIComponent('A mensagem foi salva no sistema, mas o envio ao WhatsApp falhou.')}`);
    }
  }
  res.redirect(`/conversations?id=${conversationId}&feedback_type=success&feedback=${encodeURIComponent('Mensagem registrada no sistema.')}`);
});

router.post('/conversations/:id/assign', requireAuth, async (req, res) => {
  const currentUser = res.locals.currentUser;
  await assignConversation({ tenantId: currentUser.tenant_id, conversationId: req.params.id, toUserId: req.body.user_id, fromUserId: currentUser.id, reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });
  res.redirect(`/conversations?id=${req.params.id}&feedback_type=success&feedback=${encodeURIComponent('Conversa transferida com sucesso.')}`);
});

router.post('/conversations/:id/queue', requireAuth, async (req, res) => {
  const currentUser = res.locals.currentUser;
  await moveToQueue({ tenantId: currentUser.tenant_id, conversationId: req.params.id, fromUserId: currentUser.id, priority: req.body.priority || 'normal', reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });

  if (req.body.auto_assign === '1') {
    await autoAssignConversation({ tenantId: currentUser.tenant_id, conversationId: req.params.id, reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });
  }

  res.redirect(`/conversations?id=${req.params.id}&feedback_type=success&feedback=${encodeURIComponent('Conversa movida para a fila.')}`);
});

router.post('/conversations/:id/close', requireAuth, async (req, res) => {
  const currentUser = res.locals.currentUser;
  await closeConversation({ tenantId: currentUser.tenant_id, conversationId: req.params.id, userId: currentUser.id, reqMeta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });
  res.redirect('/conversations?feedback_type=success&feedback=' + encodeURIComponent('Conversa encerrada.'));
});

export default router;

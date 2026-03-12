import express from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { encryptText } from '../services/cryptoService.js';
import { writeAuditLog } from '../services/auditService.js';

const router = express.Router();

function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function toIntOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (normalized === '') return null;

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed)) return null;

  return parsed;
}

function toIntOrDefault(value, defaultValue) {
  const parsed = toIntOrNull(value);
  return parsed === null ? defaultValue : parsed;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 'on' || value === '1' || value === 1;
}

function parseBotFlowJson(rawValue) {
  const value = toNullableString(rawValue);
  if (!value) return {};
  return JSON.parse(value);
}

router.get('/settings', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const tenantId = res.locals.currentUser.tenant_id;

    const [tenantRes, settingsRes, lgpdRes, auditRes] = await Promise.all([
      pool.query('select * from tenants where id = $1', [tenantId]),
      pool.query('select * from tenant_settings where tenant_id = $1', [tenantId]),
      pool.query(
        'select * from lgpd_requests where tenant_id = $1 order by created_at desc limit 20',
        [tenantId]
      ),
      pool.query(
        'select * from audit_logs where tenant_id = $1 order by created_at desc limit 20',
        [tenantId]
      )
    ]);

    res.render('settings/index', {
      title: 'Configurações',
      tenant: tenantRes.rows[0] || null,
      settings: settingsRes.rows[0] || null,
      lgpdRequests: lgpdRes.rows || [],
      audits: auditRes.rows || [],
      feedback: {
        type: req.query.feedback_type || null,
        message: req.query.feedback || null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/settings', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const currentUser = res.locals.currentUser;

    const welcomeMessage = toNullableString(req.body.welcome_message);
    const metaPhoneNumberId = toNullableString(req.body.meta_phone_number_id);
    const rawMetaAccessToken = toNullableString(req.body.meta_access_token);
    const metaBusinessAccountId = toNullableString(req.body.meta_business_account_id);
    const metaVerifyToken = toNullableString(req.body.meta_verify_token);
    const retentionDays = toIntOrNull(req.body.retention_days);
    const privacyContactEmail = toNullableString(req.body.privacy_contact_email);
    const lgpdNotice = toNullableString(req.body.lgpd_notice);
    const botFlowJson = parseBotFlowJson(req.body.bot_flow_json);

    const maxOpenConversationsPerAgent = toIntOrDefault(
      req.body.max_open_conversations_per_agent,
      25
    );

    const autoAssignEnabled = toBoolean(req.body.auto_assign_enabled);
    const attachmentEnabled = toBoolean(req.body.attachment_enabled);

    const encryptedMetaAccessToken = rawMetaAccessToken ? encryptText(rawMetaAccessToken) : null;

    await pool.query(
      `update tenants
        set welcome_message = $2,
            meta_phone_number_id = $3,
            meta_access_token = coalesce($4::text, meta_access_token),
            meta_business_account_id = $5,
            meta_verify_token = $6,
            retention_days = $7,
            privacy_contact_email = $8,
            bot_flow_json = $9::jsonb,
            updated_at = now()
        where id = $1`,
      [
        currentUser.tenant_id,
        welcomeMessage,
        metaPhoneNumberId,
        encryptedMetaAccessToken,
        metaBusinessAccountId,
        metaVerifyToken,
        retentionDays,
        privacyContactEmail,
        JSON.stringify(botFlowJson || {})
      ]
    );

    await pool.query(
      `insert into tenant_settings (
         tenant_id,
         lgpd_notice,
         max_open_conversations_per_agent,
         auto_assign_enabled,
         attachment_enabled
       )
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id) do update set
         lgpd_notice = excluded.lgpd_notice,
         max_open_conversations_per_agent = excluded.max_open_conversations_per_agent,
         auto_assign_enabled = excluded.auto_assign_enabled,
         attachment_enabled = excluded.attachment_enabled,
         updated_at = now()`,
      [
        currentUser.tenant_id,
        lgpdNotice,
        maxOpenConversationsPerAgent,
        autoAssignEnabled,
        attachmentEnabled
      ]
    );

    await writeAuditLog({
      tenantId: currentUser.tenant_id,
      userId: currentUser.id,
      action: 'settings.updated',
      entityType: 'tenant',
      entityId: currentUser.tenant_id,
      details: {
        retention_days: retentionDays,
        privacy_contact_email: privacyContactEmail,
        max_open_conversations_per_agent: maxOpenConversationsPerAgent,
        auto_assign_enabled: autoAssignEnabled,
        attachment_enabled: attachmentEnabled,
        meta_phone_number_id: metaPhoneNumberId,
        meta_business_account_id: metaBusinessAccountId,
        token_updated: !!rawMetaAccessToken,
        bot_flow_updated: true
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.redirect('/settings?feedback_type=success&feedback=' + encodeURIComponent('Configurações atualizadas com sucesso.'));
  } catch (error) {
    const message = error instanceof SyntaxError
      ? 'O JSON do fluxo do bot é inválido.'
      : 'Não foi possível salvar as configurações.';
    res.redirect('/settings?feedback_type=error&feedback=' + encodeURIComponent(message));
  }
});

router.post('/lgpd-requests', requireAuth, async (req, res, next) => {
  try {
    const currentUser = res.locals.currentUser;

    const requesterPhone = toNullableString(req.body.requester_phone);
    const requestType = toNullableString(req.body.request_type);
    const notes = toNullableString(req.body.notes);

    await pool.query(
      `insert into lgpd_requests (
         tenant_id,
         requester_phone,
         request_type,
         notes
       ) values ($1, $2, $3, $4)`,
      [currentUser.tenant_id, requesterPhone, requestType, notes]
    );

    await writeAuditLog({
      tenantId: currentUser.tenant_id,
      userId: currentUser.id,
      action: 'lgpd.request.created',
      entityType: 'lgpd_request',
      details: {
        requester_phone: requesterPhone,
        request_type: requestType
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.redirect('/settings');
  } catch (error) {
    next(error);
  }
});

export default router;

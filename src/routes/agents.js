import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../services/auditService.js';

const router = express.Router();

router.get('/agents', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `select u.*, (
      select count(*) from conversations c where c.assigned_agent_id = u.id and c.status in ('assigned','pending')
    ) as open_conversations
     from users u where u.tenant_id = $1 order by u.created_at desc`,
    [res.locals.currentUser.tenant_id]
  );
  res.render('agents/index', { title: 'Atendentes', agents: rows });
});

router.post('/agents', requireAuth, requireRole('admin'), async (req, res) => {
  const currentUser = res.locals.currentUser;
  const { full_name, email, password, role } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `insert into users (tenant_id, full_name, email, password_hash, role)
     values ($1,$2,$3,$4,$5) returning id`,
    [currentUser.tenant_id, full_name, email, passwordHash, role || 'agent']
  );
  await writeAuditLog({ tenantId: currentUser.tenant_id, userId: currentUser.id, action: 'user.created', entityType: 'user', entityId: result.rows[0].id, details: { email, role }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  res.redirect('/agents');
});

export default router;

import express from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/dashboard', requireAuth, async (req, res) => {
  const tenantId = res.locals.currentUser.tenant_id;
  const [statsRes, queueRes, auditRes] = await Promise.all([
    pool.query(
      `select
        count(*) filter (where status in ('waiting_human','assigned','bot_active')) as open_total,
        count(*) filter (where status = 'waiting_human') as waiting_total,
        count(*) filter (where status = 'assigned') as assigned_total,
        count(*) filter (where status = 'closed') as closed_total
       from conversations where tenant_id = $1`,
      [tenantId]
    ),
    pool.query(
      `select c.id, c.contact_name, c.contact_phone, c.priority, c.waiting_since
       from conversations c
       where c.tenant_id = $1 and c.status = 'waiting_human'
       order by c.waiting_since asc nulls last limit 10`,
      [tenantId]
    ),
    pool.query(
      `select action, entity_type, created_at from audit_logs where tenant_id = $1 order by created_at desc limit 8`,
      [tenantId]
    )
  ]);

  res.render('dashboard/index', {
    title: 'Dashboard',
    stats: statsRes.rows[0],
    queue: queueRes.rows,
    audits: auditRes.rows
  });
});

export default router;

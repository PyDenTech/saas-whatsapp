import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { writeAuditLog } from '../services/auditService.js';

const router = express.Router();

router.get('/', (req, res) => res.render('auth/home', { title: 'Plataforma de Atendimento Enterprise' }));
router.get('/login', (req, res) => res.render('auth/login', { title: 'Entrar', error: null }));

router.post('/login', async (req, res) => {
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const result = await pool.query(
    `select u.*, t.slug, t.company_name
     from users u
     join tenants t on t.id = u.tenant_id
     where lower(t.slug) = $1 and lower(u.email) = $2 and u.is_active = true and t.is_active = true`,
    [slug, email]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).render('auth/login', { title: 'Entrar', error: 'Tenant, e-mail ou senha inválidos.' });
  }
  const token = jwt.sign({ userId: user.id }, env.jwtSecret, { expiresIn: '12h' });
  res.cookie(env.cookieName, token, { httpOnly: true, sameSite: 'lax', secure: env.nodeEnv === 'production' });
  await pool.query('update users set last_seen_at = now() where id = $1', [user.id]);
  await writeAuditLog({ tenantId: user.tenant_id, userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, details: {}, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  res.redirect('/dashboard');
});

router.post('/logout', requireAuth, async (req, res) => {
  const currentUser = res.locals.currentUser;
  res.clearCookie(env.cookieName);
  await writeAuditLog({ tenantId: currentUser.tenant_id, userId: currentUser.id, action: 'auth.logout', entityType: 'user', entityId: currentUser.id, details: {}, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  res.redirect('/login');
});

export default router;

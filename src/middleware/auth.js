import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';

export async function attachUser(req, res, next) {
  try {
    const token = req.cookies?.[env.cookieName];
    if (!token) {
      res.locals.currentUser = null;
      return next();
    }
    const decoded = jwt.verify(token, env.jwtSecret);
    const { rows } = await pool.query(
      `select u.id, u.full_name, u.email, u.role, u.tenant_id, t.slug, t.company_name
       from users u
       join tenants t on t.id = u.tenant_id
       where u.id = $1 and u.is_active = true and t.is_active = true`,
      [decoded.userId]
    );
    res.locals.currentUser = rows[0] || null;
    next();
  } catch {
    res.clearCookie(env.cookieName);
    res.locals.currentUser = null;
    next();
  }
}

export function requireAuth(req, res, next) {
  if (!res.locals.currentUser) return res.redirect('/login');
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!res.locals.currentUser || !roles.includes(res.locals.currentUser.role)) {
      return res.status(403).render('dashboard/error', { title: 'Acesso negado', message: 'Você não possui permissão para acessar este recurso.' });
    }
    next();
  };
}

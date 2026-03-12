import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';

const passwordHash = await bcrypt.hash('123456', 10);
const tenant = await pool.query(`select id from tenants where lower(slug)=lower($1) limit 1`, ['demo']);
if (!tenant.rows[0]) {
  console.error('Tenant demo não encontrado. Rode primeiro: npm run db:init && npm run db:seed');
  process.exit(1);
}
const tenantId = tenant.rows[0].id;
await pool.query(
  `insert into users (tenant_id, full_name, email, password_hash, role, is_active)
   values ($1,$2,$3,$4,$5,true)
   on conflict (tenant_id, email) do update
   set password_hash = excluded.password_hash, full_name = excluded.full_name, role = excluded.role, is_active = true`,
  [tenantId, 'Administrador Demo', 'admin@demo.local', passwordHash, 'admin']
);
console.log('Usuário demo recriado/atualizado com sucesso. Login: demo / admin@demo.local / 123456');
await pool.end();

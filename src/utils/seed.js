import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { encryptText } from '../services/cryptoService.js';

const passwordHash = await bcrypt.hash('123456', 10);
const bot = {
  greeting: 'Olá! Sou o assistente do transporte. Escolha uma opção: 1-Rotas, 2-Horários, 3-Cadastro, 4-Falar com atendente',
  options: {
    '1': 'Para consultar rotas, envie o nome do aluno e a linha desejada.',
    '2': 'Para horários, informe a escola e o turno.',
    '3': 'Para cadastro, envie nome completo do aluno, escola e endereço.',
    '4': 'Vou transferir você para um atendente humano.'
  }
};

const tenantRes = await pool.query(
  `insert into tenants (company_name, slug, welcome_message, meta_verify_token, meta_phone_number_id, meta_access_token, meta_business_account_id, bot_flow_json)
   values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
   on conflict (slug) do update set company_name = excluded.company_name
   returning id`,
  ['Tenant Demo Transporte', 'demo', 'Bem-vindo ao atendimento de transporte.', 'verify-demo', '123456789', encryptText('demo-token'), 'waba-demo', JSON.stringify(bot)]
);

const tenantId = tenantRes.rows[0].id;

const userRes = await pool.query(
  `insert into users (tenant_id, full_name, email, password_hash, role)
   values ($1,$2,$3,$4,$5)
   on conflict (tenant_id, email) do update set full_name = excluded.full_name, password_hash = excluded.password_hash, role = excluded.role, is_active = true
   returning id`,
  [tenantId, 'Administrador Demo', 'admin@demo.local', passwordHash, 'admin']
);

const userId = userRes.rows[0].id;

const convRes = await pool.query(
  `insert into conversations (tenant_id, contact_name, contact_phone, status, priority, assigned_agent_id, last_message)
   values ($1,$2,$3,$4,$5,$6,$7)
   returning id`,
  [tenantId, 'Maria do Carmo', '5594999999999', 'assigned', 'high', userId, 'Preciso saber o horário do ônibus.']
);

const convId = convRes.rows[0].id;
await pool.query(
  `insert into messages (conversation_id, tenant_id, sender_type, body) values
   ($1,$2,'contact','Olá, preciso saber o horário do ônibus da Escola Tancredo.'),
   ($1,$2,'agent','Olá, vou verificar para você agora.')`,
  [convId, tenantId]
);

console.log('Seed concluído. Tenant demo / admin@demo.local / 123456');
await pool.end();

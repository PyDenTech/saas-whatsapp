import { decryptText } from './cryptoService.js';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';

export async function sendWhatsAppText({ tenantId, to, body }) {
  const { rows } = await pool.query('select meta_phone_number_id, meta_access_token from tenants where id = $1', [tenantId]);
  const tenant = rows[0];
  if (!tenant?.meta_phone_number_id || !tenant?.meta_access_token) {
    throw new Error('Tenant sem credenciais Meta configuradas.');
  }

  const response = await fetch(`${env.metaGraphBase}/${env.metaApiVersion}/${tenant.meta_phone_number_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${decryptText(tenant.meta_access_token)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }

  return response.json();
}

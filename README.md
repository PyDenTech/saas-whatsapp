# Transport WhatsApp SaaS Enterprise

Plataforma SaaS multi-tenant para atendimento do setor de transporte com WhatsApp Cloud API oficial da Meta, bot híbrido, transferência humana, fila operacional e controles de privacidade.

## O que esta versão adiciona

- tempo real com Socket.IO
- anexos via upload
- criptografia AES-256-GCM para token da Meta em banco
- auditoria persistida em banco
- fila operacional com prioridade e eventos de fila
- base para políticas LGPD: retenção, aviso de privacidade e solicitações de titular
- rate limit e Helmet
- inbox responsiva com Tailwind CSS
- login multi-tenant
- integração oficial com webhook da Meta

## Stack

- Node.js + Express
- PostgreSQL
- Socket.IO
- Tailwind CSS via CDN
- EJS server-side

## Instalação

1. Copie `.env.example` para `.env`
2. Ajuste `DATABASE_URL`, `JWT_SECRET` e `ENCRYPTION_KEY`
3. Instale dependências:

```bash
npm install
```

4. Crie o schema:

```bash
npm run db:init
```

5. Gere os dados demo:

```bash
npm run db:seed
```

6. Inicie o sistema:

```bash
npm run dev
```

## Credenciais demo

- Tenant: `demo`
- Usuário: `admin@demo.local`
- Senha: `123456`

## Webhook oficial Meta

Validação do webhook:

```text
GET /webhooks/meta/:slug
```

Recebimento de mensagens:

```text
POST /webhooks/meta/:slug
```

## Simulação local sem Meta

```bash
curl -X POST http://localhost:3000/simulate/inbound/demo \
  -H "Content-Type: application/json" \
  -d '{"phone":"5594991112222","name":"João","body":"Quero falar com atendente"}'
```

## Observações de produção

Este pacote está muito mais próximo de uma base enterprise do que o MVP anterior, mas ainda precisa de esteira operacional antes de ser tratado como ambiente crítico totalmente blindado. Para produção crítica real, recomenda-se complementar com:

- Redis para fila distribuída e presença de atendentes
- armazenamento externo para anexos, como S3
- rotação de chaves e cofre de segredos
- observabilidade com logs centralizados, métricas e tracing
- backup, replicação e política de desastre
- teste automatizado, pipeline CI/CD e validação de segurança
- WAF, hardening de reverse proxy e segmentação de rede
- gestão formal de retenção e anonimização automática

## Estrutura principal

- `src/routes/metaWebhooks.js` integra com a API oficial da Meta
- `src/services/conversationService.js` concentra a lógica de inbox e fila
- `src/services/cryptoService.js` cifra segredos sensíveis
- `db/schema.sql` contém o modelo multi-tenant e trilhas de auditoria


## Correção rápida de login demo

Se o banco já existia de uma execução anterior e o usuário demo ficou desatualizado, rode:

```bash
npm run db:repair-demo
```

Isso recria/atualiza o usuário demo com estas credenciais:

- Tenant: `demo`
- Usuário: `admin@demo.local`
- Senha: `123456`

## Verificação no PostgreSQL

Para conferir se o tenant e o usuário demo existem:

```sql
select t.slug, u.email, u.is_active
from users u
join tenants t on t.id = u.tenant_id
where t.slug = 'demo' and u.email = 'admin@demo.local';
```

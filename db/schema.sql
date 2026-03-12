create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  company_name varchar(180) not null,
  slug varchar(80) not null unique,
  is_active boolean not null default true,
  welcome_message text,
  meta_phone_number_id varchar(120),
  meta_access_token text,
  meta_business_account_id varchar(120),
  meta_verify_token varchar(180),
  bot_flow_json jsonb not null default '{}'::jsonb,
  retention_days integer not null default 365,
  privacy_contact_email varchar(180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  full_name varchar(180) not null,
  email varchar(180) not null,
  password_hash text not null,
  role varchar(20) not null default 'agent',
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  lgpd_notice text,
  service_hours jsonb not null default '{"weekdays":"07:00-18:00"}'::jsonb,
  max_open_conversations_per_agent integer not null default 25,
  auto_assign_enabled boolean not null default true,
  attachment_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  protocol_code varchar(30) not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  contact_name varchar(180),
  contact_phone varchar(40) not null,
  source_channel varchar(30) not null default 'whatsapp',
  status varchar(30) not null default 'bot_active',
  priority varchar(20) not null default 'normal',
  assigned_agent_id uuid references users(id) on delete set null,
  waiting_since timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  lgpd_consent_at timestamptz,
  last_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_conversations_tenant_updated_at on conversations (tenant_id, updated_at desc);
create index if not exists idx_conversations_queue on conversations (tenant_id, status, priority, waiting_since);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  sender_type varchar(20) not null,
  body text not null,
  meta_message_id varchar(180),
  delivery_status varchar(30) not null default 'received',
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_conversation_created_at on messages (conversation_id, created_at asc);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  original_name varchar(255) not null,
  mime_type varchar(120) not null,
  file_size bigint not null,
  storage_path text not null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists conversation_queue_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  event_type varchar(40) not null,
  from_user_id uuid references users(id) on delete set null,
  to_user_id uuid references users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action varchar(60) not null,
  entity_type varchar(60) not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  ip_address varchar(80),
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_tenant_created_at on audit_logs (tenant_id, created_at desc);

create table if not exists lgpd_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  requester_phone varchar(40),
  request_type varchar(30) not null,
  status varchar(30) not null default 'open',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists outbound_failures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  payload jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

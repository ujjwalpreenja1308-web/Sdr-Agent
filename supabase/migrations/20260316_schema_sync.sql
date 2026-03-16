begin;

create extension if not exists "pgcrypto";
create extension if not exists vector;

-- The application writes string ids like:
--   workspace_<org>
--   contact_<workspace>_1
--   approval_<workspace>_batch
--   meeting_<contact>
-- so the uuid-based schema needs to be aligned to text ids for those tables.

alter table if exists workspace_members drop constraint if exists workspace_members_workspace_id_fkey;
alter table if exists icp_configs drop constraint if exists icp_configs_workspace_id_fkey;
alter table if exists contacts drop constraint if exists contacts_workspace_id_fkey;
alter table if exists email_drafts drop constraint if exists email_drafts_contact_id_fkey;
alter table if exists email_drafts drop constraint if exists email_drafts_workspace_id_fkey;
alter table if exists campaigns drop constraint if exists campaigns_workspace_id_fkey;
alter table if exists replies drop constraint if exists replies_contact_id_fkey;
alter table if exists replies drop constraint if exists replies_workspace_id_fkey;
alter table if exists meetings drop constraint if exists meetings_contact_id_fkey;
alter table if exists meetings drop constraint if exists meetings_workspace_id_fkey;
alter table if exists approval_queue drop constraint if exists approval_queue_workspace_id_fkey;
alter table if exists performance_metrics drop constraint if exists performance_metrics_workspace_id_fkey;
alter table if exists chat_messages drop constraint if exists chat_messages_workspace_id_fkey;
alter table if exists workspace_settings drop constraint if exists workspace_settings_workspace_id_fkey;
alter table if exists audit_log drop constraint if exists audit_log_workspace_id_fkey;
alter table if exists knowledge_chunks drop constraint if exists knowledge_chunks_workspace_id_fkey;
alter table if exists adaptive_signals drop constraint if exists adaptive_signals_workspace_id_fkey;

alter table if exists workspaces alter column id drop default;
alter table if exists contacts alter column id drop default;
alter table if exists email_drafts alter column id drop default;
alter table if exists campaigns alter column id drop default;
alter table if exists replies alter column id drop default;
alter table if exists meetings alter column id drop default;
alter table if exists approval_queue alter column id drop default;

alter table if exists workspaces alter column id type text using id::text;

alter table if exists workspace_members alter column workspace_id type text using workspace_id::text;
alter table if exists icp_configs alter column workspace_id type text using workspace_id::text;
alter table if exists contacts alter column id type text using id::text;
alter table if exists contacts alter column workspace_id type text using workspace_id::text;
alter table if exists email_drafts alter column id type text using id::text;
alter table if exists email_drafts alter column contact_id type text using contact_id::text;
alter table if exists email_drafts alter column workspace_id type text using workspace_id::text;
alter table if exists campaigns alter column id type text using id::text;
alter table if exists campaigns alter column workspace_id type text using workspace_id::text;
alter table if exists replies alter column id type text using id::text;
alter table if exists replies alter column contact_id type text using contact_id::text;
alter table if exists replies alter column workspace_id type text using workspace_id::text;
alter table if exists meetings alter column id type text using id::text;
alter table if exists meetings alter column contact_id type text using contact_id::text;
alter table if exists meetings alter column workspace_id type text using workspace_id::text;
alter table if exists approval_queue alter column id type text using id::text;
alter table if exists approval_queue alter column workspace_id type text using workspace_id::text;
alter table if exists performance_metrics alter column workspace_id type text using workspace_id::text;
alter table if exists chat_messages alter column workspace_id type text using workspace_id::text;
alter table if exists workspace_settings alter column workspace_id type text using workspace_id::text;
alter table if exists audit_log alter column workspace_id type text using workspace_id::text;
alter table if exists audit_log alter column entity_id type text using entity_id::text;
alter table if exists audit_log alter column actor_id type text using actor_id::text;
alter table if exists knowledge_chunks alter column workspace_id type text using workspace_id::text;
alter table if exists adaptive_signals alter column workspace_id type text using workspace_id::text;

alter table if exists workspaces alter column id set default gen_random_uuid()::text;
alter table if exists contacts alter column id set default gen_random_uuid()::text;
alter table if exists email_drafts alter column id set default gen_random_uuid()::text;
alter table if exists campaigns alter column id set default gen_random_uuid()::text;
alter table if exists replies alter column id set default gen_random_uuid()::text;
alter table if exists meetings alter column id set default gen_random_uuid()::text;
alter table if exists approval_queue alter column id set default gen_random_uuid()::text;

alter table if exists contacts
    add column if not exists quality_score numeric(5,2),
    add column if not exists email_verification_status text not null default 'unverified',
    add column if not exists email_verification_score numeric(5,2),
    add column if not exists email_verification_note text,
    add column if not exists verification_checked_at timestamptz;

create table if not exists workspace_connections (
    workspace_id text not null references workspaces(id) on delete cascade,
    toolkit text not null,
    connection_request_id text,
    connected_account_id text,
    session_id text,
    status text not null default 'not_connected',
    mode text not null default 'oauth',
    external_user_id text,
    note text,
    updated_at timestamptz not null default now(),
    primary key (workspace_id, toolkit)
);

create index if not exists workspace_connections_toolkit_status_idx
    on workspace_connections (toolkit, status);

create table if not exists prospect_runs (
    workspace_id text primary key references workspaces(id) on delete cascade,
    status text not null default 'idle',
    mode text not null default 'mock',
    sourced_count integer not null default 0,
    enriched_count integer not null default 0,
    deduped_count integer not null default 0,
    filters_json jsonb not null default '[]'::jsonb,
    note text not null default '',
    last_run_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists webhook_subscriptions (
    workspace_id text not null references workspaces(id) on delete cascade,
    provider text not null,
    configured boolean not null default false,
    webhook_id text,
    target_url text,
    event_type text not null default 'all_events',
    secret_configured boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (workspace_id, provider)
);

create table if not exists org_monthly_usage (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations(id) on delete cascade,
    metric text not null,
    period_start date not null,
    used_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (org_id, metric, period_start)
);

create index if not exists campaigns_instantly_campaign_id_idx
    on campaigns (instantly_campaign_id);

create index if not exists audit_log_workspace_entity_created_idx
    on audit_log (workspace_id, entity_type, created_at desc);

alter table if exists workspace_members
    add constraint workspace_members_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists icp_configs
    add constraint icp_configs_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists contacts
    add constraint contacts_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists email_drafts
    add constraint email_drafts_contact_id_fkey
    foreign key (contact_id) references contacts(id) on delete cascade;

alter table if exists email_drafts
    add constraint email_drafts_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists campaigns
    add constraint campaigns_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists replies
    add constraint replies_contact_id_fkey
    foreign key (contact_id) references contacts(id) on delete set null;

alter table if exists replies
    add constraint replies_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists meetings
    add constraint meetings_contact_id_fkey
    foreign key (contact_id) references contacts(id) on delete set null;

alter table if exists meetings
    add constraint meetings_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists approval_queue
    add constraint approval_queue_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists performance_metrics
    add constraint performance_metrics_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists chat_messages
    add constraint chat_messages_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists workspace_settings
    add constraint workspace_settings_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists audit_log
    add constraint audit_log_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists knowledge_chunks
    add constraint knowledge_chunks_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table if exists adaptive_signals
    add constraint adaptive_signals_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;

commit;

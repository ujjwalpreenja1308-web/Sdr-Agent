create extension if not exists "pgcrypto";

create table if not exists organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    plan_tier text not null default 'starter',
    stripe_customer_id text,
    trial_ends_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists workspaces (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations(id) on delete cascade,
    name text not null,
    apollo_key_enc text,
    instantly_key_enc text,
    composio_entity_id text,
    created_at timestamptz not null default now()
);

create table if not exists workspace_members (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    user_id uuid not null,
    role text not null default 'owner',
    created_at timestamptz not null default now(),
    unique (workspace_id, user_id)
);

create table if not exists icp_configs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    industries text[] not null default '{}',
    titles text[] not null default '{}',
    company_sizes text[] not null default '{}',
    geos text[] not null default '{}',
    pain_points text,
    cta text,
    voice_guidelines text,
    apollo_filter_json jsonb not null default '{}'::jsonb,
    strategy_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists contacts (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    email text,
    first_name text,
    last_name text,
    title text,
    company text,
    linkedin_url text,
    apollo_id text,
    status text not null default 'drafted',
    enriched_at timestamptz,
    never_contact boolean not null default false,
    signal_type text,
    signal_detail text,
    created_at timestamptz not null default now()
);

create unique index if not exists contacts_workspace_email_idx
    on contacts (workspace_id, email)
    where email is not null;

create table if not exists email_drafts (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid not null references contacts(id) on delete cascade,
    workspace_id uuid not null references workspaces(id) on delete cascade,
    subject_1 text,
    subject_2 text,
    subject_3 text,
    subject_4 text,
    body_1 text,
    body_2 text,
    body_3 text,
    body_4 text,
    personalization_signal text,
    quality_score numeric(5,2),
    approved_at timestamptz,
    instantly_lead_id text,
    created_at timestamptz not null default now()
);

create table if not exists campaigns (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    instantly_campaign_id text,
    week_start date not null,
    contact_count integer not null default 0,
    status text not null default 'draft',
    template_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists replies (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid references contacts(id) on delete set null,
    workspace_id uuid not null references workspaces(id) on delete cascade,
    reply_text text,
    classification text,
    confidence numeric(4,3),
    draft_response text,
    approved_at timestamptz,
    sent_at timestamptz,
    instantly_email_id text,
    resume_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists meetings (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid references contacts(id) on delete set null,
    workspace_id uuid not null references workspaces(id) on delete cascade,
    scheduled_at timestamptz,
    calendar_event_id text,
    prep_brief_json jsonb not null default '{}'::jsonb,
    outcome text,
    outcome_notes text,
    created_at timestamptz not null default now()
);

create table if not exists approval_queue (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    type text not null,
    payload_json jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    priority text not null default 'medium',
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolved_by uuid
);

create table if not exists performance_metrics (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    week_start date not null,
    contacts_sourced integer not null default 0,
    emails_sent integer not null default 0,
    open_rate numeric(5,2) not null default 0,
    reply_rate numeric(5,2) not null default 0,
    positive_reply_rate numeric(5,2) not null default 0,
    meetings_booked integer not null default 0,
    top_signal text,
    top_subject text,
    created_at timestamptz not null default now(),
    unique (workspace_id, week_start)
);

create table if not exists chat_messages (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    role text not null,
    content text not null,
    tool_calls_json jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists workspace_settings (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null unique references workspaces(id) on delete cascade,
    auto_approve_json jsonb not null default '{}'::jsonb,
    sending_schedule_json jsonb not null default '{}'::jsonb,
    optimization_enabled boolean not null default true,
    weekly_report_enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists audit_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    action text not null,
    entity_type text not null,
    entity_id uuid,
    actor_type text not null,
    actor_id uuid,
    metadata_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists contacts_workspace_status_idx on contacts (workspace_id, status);
create index if not exists approval_queue_workspace_status_idx on approval_queue (workspace_id, status);
create index if not exists replies_workspace_created_idx on replies (workspace_id, created_at desc);
create index if not exists meetings_workspace_scheduled_idx on meetings (workspace_id, scheduled_at desc);
create index if not exists chat_messages_workspace_created_idx on chat_messages (workspace_id, created_at desc);

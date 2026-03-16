begin;

-- ─── Email Sequences ──────────────────────────────────────────────────────────
-- Self-owned multi-step email sequencing: ice breakers, follow-ups, breakup emails.
-- Contacts are enrolled in a sequence; a cron tick advances each enrollment
-- through its steps at the configured day intervals, sending via the SMTP pool.

create table if not exists sequences (
  id           uuid    primary key default gen_random_uuid(),
  workspace_id text    not null,
  name         text    not null,
  description  text,
  status       text    not null default 'draft', -- draft | active | archived
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists sequences_workspace_status_idx
  on sequences (workspace_id, status);

-- ─── Steps ───────────────────────────────────────────────────────────────────
-- Each step has a position (0 = icebreaker), a delay from the previous step,
-- and a subject + body template supporting {{firstName}}, {{company}}, etc.

create table if not exists sequence_steps (
  id               uuid primary key default gen_random_uuid(),
  sequence_id      uuid not null references sequences(id) on delete cascade,
  position         int  not null,          -- 0-based, ascending
  step_type        text not null default 'follow_up', -- icebreaker | follow_up | breakup
  delay_days       int  not null default 3, -- days after previous step (ignored for position 0)
  subject_template text not null,
  body_template    text not null,
  created_at       timestamptz not null default now(),
  unique (sequence_id, position)
);

-- ─── Enrollments ─────────────────────────────────────────────────────────────
-- One row per (sequence, contact) pair. Tracks which step is next and when.

create table if not exists sequence_enrollments (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid not null references sequences(id) on delete cascade,
  contact_id   text not null,
  workspace_id text not null,
  status       text not null default 'active',
    -- active | paused | completed | replied | bounced | unsubscribed
  current_step int  not null default 0,   -- index of the next step to send
  enrolled_at  timestamptz not null default now(),
  next_send_at timestamptz,               -- null means: send on next tick
  completed_at timestamptz,
  unique (sequence_id, contact_id)
);

-- Partial index: the tick query only touches active enrollments that are due
create index if not exists sequence_enrollments_tick_idx
  on sequence_enrollments (workspace_id, next_send_at)
  where status = 'active';

-- ─── Send log ────────────────────────────────────────────────────────────────
-- One row per email actually sent; provides per-step delivery history.

create table if not exists sequence_send_logs (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references sequence_enrollments(id) on delete cascade,
  step_id       uuid not null references sequence_steps(id) on delete cascade,
  contact_id    text not null,
  inbox_id      uuid,                     -- null if no outreach inbox was available
  workspace_id  text not null,
  message_id    text,
  subject       text,
  from_email    text,
  status        text not null default 'sent', -- sent | bounced | failed
  error         text,
  sent_at       timestamptz not null default now()
);

create index if not exists sequence_send_logs_enrollment_idx
  on sequence_send_logs (enrollment_id, sent_at desc);

commit;

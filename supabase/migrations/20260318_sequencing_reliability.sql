begin;

-- ─── Sequencing reliability columns ──────────────────────────────────────────
--
-- send_attempts    — counts consecutive failed sends on the current step.
--                    After 3 failures the enrollment is marked 'bounced' so a
--                    permanently-undeliverable address never burns inbox quota again.
--
-- last_tick_at     — timestamp set atomically before processing each enrollment.
--                    The tick query filters to rows where this is NULL or older
--                    than 10 minutes, acting as a soft concurrency lock so two
--                    simultaneous ticks cannot double-send to the same contact.
--
-- assigned_inbox_id — UUID of the warming inbox permanently assigned to this
--                    enrollment.  All steps in the sequence are sent from the
--                    same inbox so the contact always sees the same From: address.

alter table if exists sequence_enrollments
  add column if not exists send_attempts     int  not null default 0,
  add column if not exists last_tick_at      timestamptz,
  add column if not exists assigned_inbox_id uuid;

-- Drop the old partial index and replace with one that also guards on last_tick_at
drop index if exists sequence_enrollments_tick_idx;

create index if not exists sequence_enrollments_tick_idx
  on sequence_enrollments (workspace_id, next_send_at, last_tick_at)
  where status = 'active';

commit;

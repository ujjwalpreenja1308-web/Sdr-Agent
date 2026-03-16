-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Deliverability hardening
-- - bounce_type column on sequence_send_logs (hard vs soft bounce)
-- - increment_outreach_sends RPC (atomic upsert replacing read-then-write)
-- - increment_actual_replies RPC (for warmup reply simulation)
-- - Indexes to support bounce analysis queries
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. bounce_type on sequence_send_logs ─────────────────────────────────────

ALTER TABLE sequence_send_logs
  ADD COLUMN IF NOT EXISTS bounce_type text
    CHECK (bounce_type IN ('hard', 'soft'));

COMMENT ON COLUMN sequence_send_logs.bounce_type IS
  'hard = permanent address failure (never retry, mark contact invalid); '
  'soft = transient failure (retry with back-off); '
  'null = send succeeded or error is non-bounce infrastructure failure';

-- Index for bounce analysis dashboards
CREATE INDEX IF NOT EXISTS idx_ssl_bounce_type
  ON sequence_send_logs (workspace_id, bounce_type)
  WHERE bounce_type IS NOT NULL;

-- ── 2. replied column on warming_logs ────────────────────────────────────────
-- Tracks whether the recipient sent a reply (warmup reply simulation)

ALTER TABLE warming_logs
  ADD COLUMN IF NOT EXISTS replied boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN warming_logs.replied IS
  'True when the recipient inbox sent a reply during warming engagement (reply simulation)';

-- ── 3. Atomic outreach send counter ──────────────────────────────────────────
-- Replaces the read-then-write pattern that had a race condition.

CREATE OR REPLACE FUNCTION increment_outreach_sends(
  p_inbox_id text,
  p_date     text,
  p_target   integer
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO warming_schedule (inbox_id, date, target_sends, actual_sends)
  VALUES (p_inbox_id, p_date::date, p_target, 1)
  ON CONFLICT (inbox_id, date)
  DO UPDATE SET
    actual_sends = warming_schedule.actual_sends + 1,
    target_sends = GREATEST(warming_schedule.target_sends, p_target);
END;
$$;

COMMENT ON FUNCTION increment_outreach_sends IS
  'Atomically increment actual_sends for an inbox on a given date, '
  'creating the row if it does not exist.';

-- ── 4. Atomic reply counter ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_actual_replies(
  p_inbox_id text,
  p_date     text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO warming_schedule (inbox_id, date, actual_replies)
  VALUES (p_inbox_id, p_date::date, 1)
  ON CONFLICT (inbox_id, date)
  DO UPDATE SET actual_replies = warming_schedule.actual_replies + 1;
END;
$$;

COMMENT ON FUNCTION increment_actual_replies IS
  'Atomically increment actual_replies for an inbox on a given date.';

-- ── 5. Index for health score auto-pause queries ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_warming_inboxes_health_active
  ON warming_inboxes (workspace_id, health_score)
  WHERE status = 'active';

-- ── 6. Index for sequence tick — due enrollments ─────────────────────────────
-- Speeds up the hourly tick query that claims due active enrollments

CREATE INDEX IF NOT EXISTS idx_enrollments_tick_claim
  ON sequence_enrollments (workspace_id, status, next_send_at, last_tick_at)
  WHERE status = 'active';

-- ── 7. Index for invalid-email skip on enrollContacts ────────────────────────

CREATE INDEX IF NOT EXISTS idx_contacts_email_verification
  ON contacts (workspace_id, email_verification_status)
  WHERE email_verification_status = 'invalid';

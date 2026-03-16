-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Row-Level Security policies for tenant isolation
--
-- These policies ensure that even if someone obtains a Supabase anon key,
-- they can only access data belonging to workspaces they are a member of.
-- The service_role key used by the API backend bypasses RLS by design.
--
-- auth.uid() returns the Supabase Auth user ID from the JWT.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: check if the current user is a member of a workspace
CREATE OR REPLACE FUNCTION public.user_is_workspace_member(ws_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()::text
  );
$$;

-- Helper: check if the current user belongs to an org
CREATE OR REPLACE FUNCTION public.user_is_org_member(o_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members wm
    JOIN workspaces w ON w.id::text = wm.workspace_id
    WHERE w.org_id::text = o_id
      AND wm.user_id = auth.uid()::text
  );
$$;

-- ── Organizations ──────────────────────────────────────────────────────────

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_member" ON organizations
  FOR SELECT USING (
    user_is_org_member(id::text)
  );

-- ── Workspaces ─────────────────────────────────────────────────────────────

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_select_member" ON workspaces
  FOR SELECT USING (
    user_is_workspace_member(id::text)
  );

-- ── Workspace Members ──────────────────────────────────────────────────────

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wm_select_own" ON workspace_members
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "wm_select_coworker" ON workspace_members
  FOR SELECT USING (
    user_is_workspace_member(workspace_id)
  );

-- ── All workspace-scoped tables ────────────────────────────────────────────
-- Pattern: SELECT/INSERT/UPDATE/DELETE require workspace membership

-- contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_member" ON contacts
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- email_drafts
ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_drafts_member" ON email_drafts
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- campaigns
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_member" ON campaigns
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- replies
ALTER TABLE replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "replies_member" ON replies
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- meetings
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meetings_member" ON meetings
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- approval_queue
ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_queue_member" ON approval_queue
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- chat_messages
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_messages_member" ON chat_messages
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- icp_configs
ALTER TABLE icp_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "icp_configs_member" ON icp_configs
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- workspace_settings
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_settings_member" ON workspace_settings
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- performance_metrics
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "performance_metrics_member" ON performance_metrics
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- knowledge_chunks
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_chunks_member" ON knowledge_chunks
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- adaptive_signals
ALTER TABLE adaptive_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adaptive_signals_member" ON adaptive_signals
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- audit_log (read-only for users; system writes via service key)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_select_member" ON audit_log
  FOR SELECT USING (user_is_workspace_member(workspace_id));

-- warming_inboxes
ALTER TABLE warming_inboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "warming_inboxes_member" ON warming_inboxes
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- warming_logs
ALTER TABLE warming_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "warming_logs_member" ON warming_logs
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- warming_schedule
ALTER TABLE warming_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "warming_schedule_member" ON warming_schedule
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM warming_inboxes wi
      WHERE wi.id::text = warming_schedule.inbox_id
        AND user_is_workspace_member(wi.workspace_id)
    )
  );

-- sequences
ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sequences_member" ON sequences
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- sequence_steps (via sequence ownership)
ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sequence_steps_member" ON sequence_steps
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM sequences s
      WHERE s.id = sequence_steps.sequence_id
        AND user_is_workspace_member(s.workspace_id)
    )
  );

-- sequence_enrollments
ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sequence_enrollments_member" ON sequence_enrollments
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- sequence_send_logs
ALTER TABLE sequence_send_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sequence_send_logs_member" ON sequence_send_logs
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- org_monthly_usage
ALTER TABLE org_monthly_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_usage_member" ON org_monthly_usage
  FOR SELECT USING (user_is_org_member(org_id::text));

-- webhook_subscriptions
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhook_subs_member" ON webhook_subscriptions
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- workspace_connections
ALTER TABLE workspace_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_connections_member" ON workspace_connections
  FOR ALL USING (user_is_workspace_member(workspace_id));

-- prospect_runs
ALTER TABLE prospect_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_runs_member" ON prospect_runs
  FOR ALL USING (user_is_workspace_member(workspace_id));

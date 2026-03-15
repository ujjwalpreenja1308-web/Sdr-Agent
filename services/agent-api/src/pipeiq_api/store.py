from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Literal

from .models import (
    ApprovalItem,
    ApprovalSample,
    BuildPhase,
    CampaignSummary,
    ConnectionStatus,
    ConnectionTarget,
    ContactPreview,
    InstantlyWebhookEvent,
    InstantlyWebhookSubscription,
    LaunchChecklistItem,
    LaunchReadiness,
    LaunchResult,
    MeetingPrepItem,
    MetricCard,
    OnboardingProfile,
    PipelineMetric,
    PipelineSnapshot,
    ProspectRunSummary,
    ReplyQueueItem,
    WebhookReceipt,
    WorkspaceSummary,
)


ConnectionMode = Literal["oauth", "api_key"]
ConnectionState = Literal["not_connected", "pending", "connected"]


class InMemoryStore:
    def __init__(self) -> None:
        self._state_path = Path(__file__).resolve().parents[2] / "data" / "state.json"
        self._workspace = WorkspaceSummary(
            id="default",
            name="PipeIQ Launch Workspace",
            greeting="Connect your stack, answer a few strategy questions, then let PipeIQ run the weekly outbound loop.",
            proposition="Pre-rendered outbound, human approvals where needed, and a single agent surface for the full pipeline.",
            phase_focus="Phase 1 scaffold: onboarding, connections, approval-ready pipeline context, and AI SDR control plane.",
            onboarding_completed=False,
            onboarding_progress=0,
            metrics=[
                MetricCard(
                    label="Target Price",
                    value="$99-$599/mo",
                    caption="Aligned to the PRD pricing envelope.",
                ),
                MetricCard(
                    label="Core Agents",
                    value="4 + optimizer",
                    caption="Prospect, personalization, reply, meeting, and weekly optimization.",
                ),
                MetricCard(
                    label="Launch Goal",
                    value="< 24h",
                    caption="Time to first approved email batch from signup.",
                ),
            ],
            phases=[
                BuildPhase(
                    name="Phase 1",
                    duration="Weeks 1-4",
                    outcome="Onboarding, prospect flow, personalization, approvals, and campaign launch seam.",
                    status="active",
                ),
                BuildPhase(
                    name="Phase 2",
                    duration="Weeks 5-7",
                    outcome="Reply intelligence, scheduling, and real-time approval events.",
                    status="next",
                ),
                BuildPhase(
                    name="Phase 3+",
                    duration="Weeks 8-14",
                    outcome="Meetings, AI chat depth, analytics, billing, and launch polish.",
                    status="later",
                ),
            ],
            strategy_questions=[
                "Who is your highest-conviction ICP this quarter?",
                "What pain points create urgency in the first email?",
                "Which CTA converts best: meeting, teardown, or audit?",
                "Which industries or company stages should always be excluded?",
            ],
            connections=[
                ConnectionTarget(
                    toolkit="apollo",
                    label="Apollo",
                    category="required",
                    mode="oauth",
                    description="Lead search and enrichment through a Composio-hosted Apollo connection.",
                    status="not_connected",
                    required_for_phase="Prospect agent",
                    note="Users enter the Apollo API key inside the Composio Connect flow.",
                ),
                ConnectionTarget(
                    toolkit="instantly",
                    label="Instantly",
                    category="required",
                    mode="oauth",
                    description="Campaign creation, launch, replies, and analytics through Composio.",
                    status="not_connected",
                    required_for_phase="Campaign launch",
                    note="Users enter the Instantly API key inside the Composio Connect flow.",
                ),
                ConnectionTarget(
                    toolkit="hunter",
                    label="Hunter",
                    category="required",
                    mode="oauth",
                    description="Email verification through a Composio-hosted Hunter connection before batch generation and launch.",
                    status="not_connected",
                    required_for_phase="Email verification",
                    note="Users enter the Hunter API key inside the Composio Connect flow.",
                ),
                ConnectionTarget(
                    toolkit="gmail",
                    label="Google Workspace / Gmail",
                    category="required",
                    mode="oauth",
                    description="Manual Composio authorization example for inbox-level workflows and future reply support.",
                    status="not_connected",
                    required_for_phase="Inbox and reply workflows",
                ),
                ConnectionTarget(
                    toolkit="googlecalendar",
                    label="Google Calendar",
                    category="optional",
                    mode="oauth",
                    description="Availability lookup and meeting booking via Composio.",
                    status="not_connected",
                    required_for_phase="Meeting agent",
                ),
                ConnectionTarget(
                    toolkit="calendly",
                    label="Calendly",
                    category="optional",
                    mode="oauth",
                    description="Alternative scheduling surface for the meeting agent.",
                    status="not_connected",
                    required_for_phase="Meeting agent",
                ),
                ConnectionTarget(
                    toolkit="hubspot",
                    label="HubSpot",
                    category="optional",
                    mode="oauth",
                    description="CRM sync target for positive replies and booked meetings.",
                    status="not_connected",
                    required_for_phase="Growth tier",
                ),
            ],
        )
        self._onboarding: dict[str, OnboardingProfile] = {
            "default": OnboardingProfile(workspace_id="default")
        }
        self._api_key_connections: dict[str, dict[str, dict[str, str]]] = {}
        self._oauth_connections: dict[str, dict[str, dict[str, str]]] = {}
        self._pipeline_generated: dict[str, bool] = {"default": False}
        self._launch_state: dict[str, dict[str, str | int]] = {}
        self._instantly_webhooks: dict[str, InstantlyWebhookSubscription] = {
            "default": InstantlyWebhookSubscription(
                workspace_id="default",
                configured=False,
                event_type="all_events",
            )
        }
        self._campaigns: dict[str, CampaignSummary] = {}
        self._replies: dict[str, list[ReplyQueueItem]] = {"default": []}
        self._meetings: dict[str, list[MeetingPrepItem]] = {"default": []}
        self._prospect_runs: dict[str, ProspectRunSummary] = {
            "default": ProspectRunSummary(
                workspace_id="default",
                status="idle",
                mode="mock",
                sourced_count=0,
                enriched_count=0,
                deduped_count=0,
                filters=[],
                note="No Apollo prospect run has been executed yet.",
                last_run_at="2026-03-15T00:00:00+05:30",
            )
        }
        self._contacts: dict[str, list[ContactPreview]] = {"default": []}
        self._approvals: dict[str, list[ApprovalItem]] = {"default": []}
        self._load_state()

    def get_workspace(self, workspace_id: str) -> WorkspaceSummary:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")

        workspace = deepcopy(self._workspace)
        onboarding = self.get_onboarding(workspace_id)
        pipeline = self.get_pipeline(workspace_id)
        workspace.onboarding_completed = onboarding.is_complete
        workspace.onboarding_progress = onboarding.completion_score
        if onboarding.product_name.strip():
            workspace.name = f"{onboarding.product_name} Workspace"
        if onboarding.product_description.strip():
            workspace.greeting = onboarding.product_description
        if onboarding.value_proposition.strip():
            workspace.proposition = onboarding.value_proposition
        workspace.strategy_questions = self._strategy_questions_for_onboarding(onboarding)
        workspace.metrics = [
            MetricCard(
                label="Onboarding",
                value=f"{onboarding.completion_score}%",
                caption="Strategy intake completion against the PRD onboarding flow.",
            ),
            MetricCard(
                label="Pending Approvals",
                value=str(self._pending_approval_count(workspace_id)),
                caption="Human review items that still block campaign launch.",
            ),
            MetricCard(
                label="Connected Tools",
                value=str(len(self.connected_toolkits_for_user(workspace_id))),
                caption="OAuth or API-key seams already attached in this workspace.",
            ),
        ]
        for connection in workspace.connections:
            connection.status = self._status_for_toolkit(workspace.id, connection.toolkit)
            oauth_record = self._oauth_connections.get(workspace.id, {}).get(connection.toolkit)
            if oauth_record:
                connection.connection_id = oauth_record["connection_id"]
                connection.note = oauth_record.get("note") or connection.note
        return workspace

    def get_onboarding(self, workspace_id: str) -> OnboardingProfile:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        return deepcopy(
            self._onboarding.get(workspace_id, OnboardingProfile(workspace_id=workspace_id))
        )

    def update_onboarding(
        self,
        workspace_id: str,
        payload: OnboardingProfile,
    ) -> OnboardingProfile:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        previous = self._onboarding.get(workspace_id)
        self._onboarding[workspace_id] = payload
        if previous and previous.model_dump() != payload.model_dump():
            self._pipeline_generated[workspace_id] = False
            self._launch_state.pop(workspace_id, None)
            self._campaigns.pop(workspace_id, None)
            self._replies[workspace_id] = []
            self._meetings[workspace_id] = []
            self._prospect_runs[workspace_id] = ProspectRunSummary(
                workspace_id=workspace_id,
                status="idle",
                mode="mock",
                sourced_count=0,
                enriched_count=0,
                deduped_count=0,
                filters=self._prospect_filters_for_workspace(workspace_id),
                note="Update the Apollo prospect run because the onboarding profile changed.",
                last_run_at="2026-03-15T00:00:00+05:30",
            )
        self._save_state()
        return self.get_onboarding(workspace_id)

    def get_prospect_run(self, workspace_id: str) -> ProspectRunSummary:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        return deepcopy(
            self._prospect_runs.get(
                workspace_id,
                ProspectRunSummary(
                    workspace_id=workspace_id,
                    status="idle",
                    mode="mock",
                    sourced_count=0,
                    enriched_count=0,
                    deduped_count=0,
                    filters=[],
                    note="No Apollo prospect run has been executed yet.",
                    last_run_at="2026-03-15T00:00:00+05:30",
                ),
            )
        )

    def apply_prospect_run(
        self,
        *,
        workspace_id: str,
        mode: Literal["live", "mock"],
        sourced_count: int,
        enriched_count: int,
        note: str,
        contacts: list[ContactPreview],
    ) -> ProspectRunSummary:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")

        deduped_contacts = self._dedupe_contacts(contacts)
        self._contacts[workspace_id] = deduped_contacts
        self._approvals[workspace_id] = []
        self._pipeline_generated[workspace_id] = False
        self._campaigns.pop(workspace_id, None)
        self._replies[workspace_id] = []
        self._meetings[workspace_id] = []
        run_summary = ProspectRunSummary(
            workspace_id=workspace_id,
            status="completed",
            mode=mode,
            sourced_count=sourced_count,
            enriched_count=enriched_count,
            deduped_count=len(deduped_contacts),
            filters=self._prospect_filters_for_workspace(workspace_id),
            note=note,
            last_run_at="2026-03-15T07:30:00+05:30",
        )
        self._prospect_runs[workspace_id] = run_summary
        self._save_state()
        return deepcopy(run_summary)

    def generate_pipeline_from_onboarding(self, workspace_id: str) -> PipelineSnapshot:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")

        onboarding = self.get_onboarding(workspace_id)
        if not onboarding.is_complete:
            raise ValueError("Complete onboarding before generating the first batch.")
        prospect_run = self.get_prospect_run(workspace_id)
        if prospect_run.status != "completed":
            raise ValueError("Run Apollo prospecting before generating the first batch.")
        eligible_contacts = [
            contact
            for contact in self._contacts.get(workspace_id, [])
            if self._is_sendable_verification_status(contact.email_verification_status)
        ]
        if not eligible_contacts:
            raise ValueError("Verify prospect emails with Hunter before generating the first batch.")
        product_name = onboarding.product_name or "PipeIQ"
        value_proposition = (
            onboarding.value_proposition
            or "A fully managed outbound system with pre-rendered emails and human approvals."
        )
        pain_points = (
            onboarding.pain_points
            or "founder-led outbound, generic sequences, and manual reply handling"
        )
        cta = onboarding.call_to_action or "a 20-minute teardown"
        contacts: list[ContactPreview] = []
        samples: list[ApprovalSample] = []

        for index, source_contact in enumerate(eligible_contacts[:10]):
            name = source_contact.full_name
            title = source_contact.title
            company = source_contact.company
            signal_type = source_contact.signal_type
            signal_detail = source_contact.signal_detail
            subject = self._render_subject(
                title=title,
                signal_type=signal_type,
                product_name=product_name,
            )
            body = self._render_body(
                contact_name=name,
                company=company,
                signal_type=signal_type,
                pain_points=pain_points,
                value_proposition=value_proposition,
                cta=cta,
            )
            status = "ready_for_review" if index < 2 else "drafted"

            contacts.append(
                ContactPreview(
                    id=source_contact.id,
                    full_name=name,
                    email=source_contact.email,
                    title=title,
                    company=company,
                    signal_type=signal_type,
                    signal_detail=signal_detail,
                    quality_score=source_contact.quality_score,
                    status=status,
                    email_verification_status=source_contact.email_verification_status,
                    email_verification_score=source_contact.email_verification_score,
                    email_verification_note=source_contact.email_verification_note,
                    verification_checked_at=source_contact.verification_checked_at,
                    subject=subject,
                    body_preview=body,
                )
            )
            samples.append(
                ApprovalSample(
                    contact_id=source_contact.id,
                    contact_name=name,
                    company=company,
                    signal=signal_type,
                    subject=subject,
                    body=body,
                )
            )

        self._contacts[workspace_id] = contacts
        self._pipeline_generated[workspace_id] = True
        self._launch_state.pop(workspace_id, None)
        self._campaigns.pop(workspace_id, None)
        self._replies[workspace_id] = []
        self._meetings[workspace_id] = []
        self._approvals[workspace_id] = [
            ApprovalItem(
                id="approval_batch_generated",
                type="batch_send",
                title="Generated outbound batch is ready",
                summary=f"{len(samples)} AI-personalized samples are ready for human review before launch.",
                status="pending",
                priority="high",
                created_at="2026-03-15T08:00:00+05:30",
                sample_size=len(samples),
                samples=samples,
            )
        ]
        self._save_state()
        return self.get_pipeline(workspace_id)

    def get_launch_readiness(self, workspace_id: str) -> LaunchReadiness:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")

        workspace = self.get_workspace(workspace_id)
        pipeline_generated = self._pipeline_generated.get(workspace_id, False)
        prospects_sourced = self.get_prospect_run(workspace_id).status == "completed"
        verified_contacts = len(
            [
                contact
                for contact in self._contacts.get(workspace_id, [])
                if self._is_sendable_verification_status(contact.email_verification_status)
            ]
        )
        approved_contacts = len(
            [
                contact
                for contact in self._contacts.get(workspace_id, [])
                if contact.status == "approved_to_launch"
                and self._is_sendable_verification_status(contact.email_verification_status)
            ]
        )
        pending_approvals = self._pending_approval_count(workspace_id)
        required_toolkits = {"apollo", "hunter", "instantly"}
        connected_toolkits = set(self.connected_toolkits_for_user(workspace_id))
        launch_record = self._launch_state.get(workspace_id)

        checklist = [
            LaunchChecklistItem(
                id="onboarding",
                label="Strategy intake saved",
                detail="Product, ICP, value proposition, and CTA are captured.",
                status="complete" if workspace.onboarding_completed else "pending",
            ),
            LaunchChecklistItem(
                id="apollo",
                label="Apollo connected",
                detail="Prospecting and enrichment seam is available.",
                status="complete" if "apollo" in connected_toolkits else "pending",
            ),
            LaunchChecklistItem(
                id="hunter",
                label="Hunter connected",
                detail="Email verification through Composio is available.",
                status="complete" if "hunter" in connected_toolkits else "pending",
            ),
            LaunchChecklistItem(
                id="instantly",
                label="Instantly connected",
                detail="Campaign creation and sending seam is available.",
                status="complete" if "instantly" in connected_toolkits else "pending",
            ),
            LaunchChecklistItem(
                id="prospects",
                label="Apollo prospects sourced",
                detail="Search and enrichment completed for the current ICP.",
                status="complete" if prospects_sourced else "pending",
            ),
            LaunchChecklistItem(
                id="verification",
                label="Prospect emails verified",
                detail="Hunter has classified which sourced emails are safe or risky to send.",
                status="complete" if verified_contacts > 0 else "pending",
            ),
            LaunchChecklistItem(
                id="batch",
                label="First batch personalized",
                detail="Contacts and pre-rendered copy exist for review.",
                status="complete" if pipeline_generated else "pending",
            ),
            LaunchChecklistItem(
                id="approval",
                label="Human approval complete",
                detail="At least one contact is approved to launch.",
                status="complete" if approved_contacts > 0 and pending_approvals == 0 else "pending",
            ),
        ]

        blockers: list[str] = []
        if not workspace.onboarding_completed:
            blockers.append("Complete onboarding to define the ICP and offer.")
        missing_required = sorted(required_toolkits - connected_toolkits)
        if missing_required:
            blockers.append(
                f"Connect required tools: {', '.join(toolkit.title() for toolkit in missing_required)}."
            )
        if not prospects_sourced:
            blockers.append("Run Apollo prospecting to source and enrich the first contact set.")
        if verified_contacts == 0:
            blockers.append("Verify sourced emails with Hunter before generating the first batch.")
        if not pipeline_generated:
            blockers.append("Generate the first personalized batch from the sourced prospects.")
        if pending_approvals > 0 or approved_contacts == 0:
            blockers.append("Approve the generated batch before staging a campaign.")

        ready_to_launch = len(blockers) == 0
        completed_items = len([item for item in checklist if item.status == "complete"])
        progress = int((completed_items / len(checklist)) * 100)
        stage: Literal["setup", "ready", "staged"] = "ready" if ready_to_launch else "setup"
        if launch_record:
            stage = "staged"

        next_action = (
            "Stage the first campaign in Instantly."
            if ready_to_launch
            else blockers[0]
        )

        return LaunchReadiness(
            workspace_id=workspace_id,
            ready_to_launch=ready_to_launch,
            progress=progress,
            stage=stage,
            contacts_ready=approved_contacts,
            pending_approvals=pending_approvals,
            blockers=blockers,
            next_action=next_action,
            checklist=checklist,
        )

    def launch_contacts(self, workspace_id: str) -> list[ContactPreview]:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        return [
            deepcopy(contact)
            for contact in self._contacts.get(workspace_id, [])
            if contact.status == "approved_to_launch"
            and self._is_sendable_verification_status(contact.email_verification_status)
        ]

    def apply_email_verifications(
        self,
        *,
        workspace_id: str,
        results: list[dict[str, str | float | None]],
    ) -> PipelineSnapshot:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")

        by_email = {
            str(result["email"]).strip().lower(): result
            for result in results
            if result.get("email")
        }
        for contact in self._contacts.get(workspace_id, []):
            payload = by_email.get(contact.email.strip().lower())
            if not payload:
                continue
            contact.email_verification_status = str(payload.get("status") or "unverified")  # type: ignore[assignment]
            score = payload.get("score")
            contact.email_verification_score = float(score) if isinstance(score, (int, float)) else None
            contact.email_verification_note = str(payload.get("note") or "")
            contact.verification_checked_at = str(
                payload.get("checked_at") or "2026-03-15T16:45:00+05:30"
            )

        self._save_state()
        return self.get_pipeline(workspace_id)

    def complete_launch(
        self,
        *,
        workspace_id: str,
        campaign_id: str,
        campaign_name: str,
        contacts_launched: int,
        provider: str,
        mode: Literal["live", "mock"],
    ) -> LaunchResult:
        readiness = self.get_launch_readiness(workspace_id)
        if not readiness.ready_to_launch:
            return LaunchResult(
                workspace_id=workspace_id,
                status="blocked",
                campaign_name=None,
                campaign_id=None,
                provider=None,
                mode=None,
                contacts_launched=0,
                message="Launch is still blocked by setup or approval gaps.",
                blockers=readiness.blockers,
            )

        self._launch_state[workspace_id] = {
            "campaign_name": campaign_name,
            "contacts_launched": readiness.contacts_ready,
        }
        self._campaigns[workspace_id] = CampaignSummary(
            workspace_id=workspace_id,
            status="running",
            campaign_name=campaign_name,
            campaign_id=campaign_id,
            provider=provider,
            mode=mode,
            contacts_launched=contacts_launched,
            reply_rate=8.1,
            positive_replies=2,
            meetings_booked=1,
            last_sync_at="2026-03-15T09:15:00+05:30",
        )
        self._campaigns[workspace_id].positive_replies = 0
        self._campaigns[workspace_id].meetings_booked = 0
        self._save_state()
        return LaunchResult(
            workspace_id=workspace_id,
            status="staged",
            campaign_name=campaign_name,
            campaign_id=campaign_id,
            provider=provider,
            mode=mode,
            contacts_launched=contacts_launched,
            message="Campaign launched into the running state.",
            blockers=[],
        )

    def get_instantly_webhook(self, workspace_id: str) -> InstantlyWebhookSubscription:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        return deepcopy(
            self._instantly_webhooks.get(
                workspace_id,
                InstantlyWebhookSubscription(
                    workspace_id=workspace_id,
                    configured=False,
                    event_type="all_events",
                ),
            )
        )

    def set_instantly_webhook(
        self,
        *,
        workspace_id: str,
        webhook_id: str,
        target_url: str,
        secret_configured: bool,
    ) -> InstantlyWebhookSubscription:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        subscription = InstantlyWebhookSubscription(
            workspace_id=workspace_id,
            configured=True,
            webhook_id=webhook_id,
            target_url=target_url,
            event_type="all_events",
            secret_configured=secret_configured,
        )
        self._instantly_webhooks[workspace_id] = subscription
        self._save_state()
        return deepcopy(subscription)

    def get_campaign(self, workspace_id: str) -> CampaignSummary:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        return deepcopy(
            self._campaigns.get(
                workspace_id,
                CampaignSummary(
                    workspace_id=workspace_id,
                    status="idle",
                    provider="instantly",
                    mode="mock",
                    contacts_launched=0,
                    reply_rate=0.0,
                    positive_replies=0,
                    meetings_booked=0,
                    last_sync_at="2026-03-15T00:00:00+05:30",
                ),
            )
        )

    def list_replies(self, workspace_id: str) -> list[ReplyQueueItem]:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        return deepcopy(self._replies.get(workspace_id, []))

    def list_meetings(self, workspace_id: str) -> list[MeetingPrepItem]:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")
        return deepcopy(self._meetings.get(workspace_id, []))

    def decide_reply(
        self,
        *,
        workspace_id: str,
        reply_id: str,
        decision: Literal["approved", "dismissed"],
    ) -> ReplyQueueItem:
        for reply in self._replies.get(workspace_id, []):
            if reply.id != reply_id:
                continue

            reply.status = decision
            if decision == "approved":
                reply.status = "sent"
                self._promote_meeting_if_needed(workspace_id, reply)
            self._save_state()
            return deepcopy(reply)
        raise KeyError(f"Unknown reply id: {reply_id}")

    def ingest_instantly_event(
        self,
        *,
        workspace_id: str,
        event: InstantlyWebhookEvent,
    ) -> WebhookReceipt:
        if workspace_id != self._workspace.id:
            raise KeyError(f"Unknown workspace: {workspace_id}")

        action = "ignored"
        if event.event_type == "reply_received":
            action = self._ingest_reply_received(workspace_id, event)
        elif event.event_type == "lead_interested":
            action = self._ingest_lead_interested(workspace_id, event)
        elif event.event_type == "lead_meeting_booked":
            action = self._ingest_meeting_booked(workspace_id, event)

        self._save_state()
        return WebhookReceipt(
            workspace_id=workspace_id,
            event_type=event.event_type,
            accepted=True,
            action=action,
        )

    def get_pipeline(self, workspace_id: str) -> PipelineSnapshot:
        contacts = deepcopy(self._contacts.get(workspace_id, []))
        ready_count = len(
            [
                contact
                for contact in contacts
                if contact.status in {"drafted", "ready_for_review", "approved_to_launch"}
            ]
        )
        verified_count = len(
            [
                contact
                for contact in contacts
                if self._is_sendable_verification_status(contact.email_verification_status)
            ]
        )
        approved_count = len(
            [
                contact
                for contact in contacts
                if contact.status == "approved_to_launch"
                and self._is_sendable_verification_status(contact.email_verification_status)
            ]
        )
        return PipelineSnapshot(
            workspace_id=workspace_id,
            metrics=[
                PipelineMetric(
                    label="Contacts sourced",
                    value=str(len(contacts)),
                    caption="Apollo-sourced prospects currently in the local workspace pipeline.",
                    tone="default",
                ),
                PipelineMetric(
                    label="Emails verified",
                    value=str(verified_count),
                    caption="Hunter-verified contacts that are safe or risky enough to use in the batch.",
                    tone="success" if verified_count > 0 else "default",
                ),
                PipelineMetric(
                    label="Ready for review",
                    value=str(ready_count),
                    caption="Drafts staged for a batch approval decision.",
                    tone="warning",
                ),
                PipelineMetric(
                    label="Approved to launch",
                    value=str(approved_count),
                    caption="Contacts unlocked for Instantly once that adapter is wired.",
                    tone="success",
                ),
            ],
            contacts=contacts,
        )

    def list_approvals(self, workspace_id: str) -> list[ApprovalItem]:
        return deepcopy(self._approvals.get(workspace_id, []))

    def record_api_key(
        self,
        *,
        workspace_id: str,
        toolkit: str,
        label: str,
        secret_hint: str,
    ) -> ConnectionStatus:
        workspace_records = self._api_key_connections.setdefault(workspace_id, {})
        workspace_records[toolkit] = {
            "label": label,
            "secret_hint": secret_hint,
        }
        self._save_state()
        return ConnectionStatus(
            toolkit=toolkit,
            connection_id=None,
            status="connected",
            mode="api_key",
            note=f"Stored masked hint for {label}. Wire this to encrypted storage next.",
        )

    def record_oauth_start(
        self,
        *,
        workspace_id: str,
        external_user_id: str,
        toolkit: str,
        connection_id: str,
        session_id: str,
        note: str | None = None,
    ) -> None:
        workspace_records = self._oauth_connections.setdefault(workspace_id, {})
        workspace_records[toolkit] = {
            "external_user_id": external_user_id,
            "connection_id": connection_id,
            "session_id": session_id,
            "status": "pending",
            "note": note or "",
        }
        self._save_state()

    def decide_approval(
        self,
        *,
        workspace_id: str,
        approval_id: str,
        decision: Literal["approved", "rejected"],
    ) -> ApprovalItem:
        approval_items = self._approvals.get(workspace_id, [])
        for approval in approval_items:
            if approval.id != approval_id:
                continue

            approval.status = decision
            new_contact_status = (
                "approved_to_launch" if decision == "approved" else "revision_requested"
            )
            for sample in approval.samples:
                self._set_contact_status(
                    workspace_id=workspace_id,
                    contact_id=sample.contact_id,
                    status=new_contact_status,
                )
            self._save_state()
            return deepcopy(approval)

        raise KeyError(f"Unknown approval id: {approval_id}")

    def set_oauth_status(
        self,
        *,
        workspace_id: str,
        toolkit: str,
        status: ConnectionState,
        note: str | None = None,
    ) -> ConnectionStatus:
        workspace_records = self._oauth_connections.setdefault(workspace_id, {})
        existing = workspace_records.setdefault(
            toolkit,
            {
                "connection_id": "",
                "session_id": "",
                "status": "pending",
                "note": "",
            },
        )
        existing["status"] = status
        if note is not None:
            existing["note"] = note
        self._save_state()
        return ConnectionStatus(
            toolkit=toolkit,
            connection_id=existing["connection_id"] or None,
            status=status,
            mode="oauth",
            note=existing["note"] or None,
        )

    def find_oauth_by_connection_id(
        self,
        connection_id: str,
    ) -> tuple[str, str] | None:
        for workspace_id, toolkit_records in self._oauth_connections.items():
            for toolkit, record in toolkit_records.items():
                if record["connection_id"] == connection_id:
                    return workspace_id, toolkit
        return None

    def connected_toolkits_for_user(self, workspace_id: str) -> list[str]:
        toolkits = [
            toolkit
            for toolkit, record in self._oauth_connections.get(workspace_id, {}).items()
            if record["status"] == "connected"
        ]
        toolkits.extend(self._api_key_connections.get(workspace_id, {}).keys())
        return sorted(set(toolkits))

    def connected_accounts_for_agent(self, workspace_id: str) -> dict[str, str]:
        return {
            toolkit: record["connection_id"]
            for toolkit, record in self._oauth_connections.get(workspace_id, {}).items()
            if record["status"] == "connected" and record["connection_id"]
        }

    def connected_account_for_toolkit(self, workspace_id: str, toolkit: str) -> str | None:
        record = self._oauth_connections.get(workspace_id, {}).get(toolkit)
        if not record or record["status"] != "connected":
            return None
        connection_id = record.get("connection_id")
        return connection_id or None

    def execution_user_id_for_toolkit(self, workspace_id: str, toolkit: str) -> str | None:
        record = self._oauth_connections.get(workspace_id, {}).get(toolkit)
        if not record:
            return None
        external_user_id = record.get("external_user_id")
        return external_user_id or None

    def _pending_approval_count(self, workspace_id: str) -> int:
        return len(
            [
                approval
                for approval in self._approvals.get(workspace_id, [])
                if approval.status == "pending"
            ]
        )

    def _set_contact_status(
        self,
        *,
        workspace_id: str,
        contact_id: str,
        status: Literal["approved_to_launch", "revision_requested"],
    ) -> None:
        for contact in self._contacts.get(workspace_id, []):
            if contact.id == contact_id:
                contact.status = status
                return

    def _status_for_toolkit(self, workspace_id: str, toolkit: str) -> ConnectionState:
        if toolkit in self._api_key_connections.get(workspace_id, {}):
            return "connected"

        oauth_record = self._oauth_connections.get(workspace_id, {}).get(toolkit)
        if oauth_record:
            return oauth_record["status"]  # type: ignore[return-value]

        return "not_connected"

    def _is_sendable_verification_status(self, status: str) -> bool:
        return status in {"valid", "risky"}

    def _dedupe_contacts(self, contacts: list[ContactPreview]) -> list[ContactPreview]:
        seen: set[tuple[str, str]] = set()
        deduped: list[ContactPreview] = []
        for contact in contacts:
            key = (contact.full_name.lower(), contact.company.lower())
            if key in seen:
                continue
            seen.add(key)
            deduped.append(contact)
        return deduped

    def _prospect_filters_for_workspace(self, workspace_id: str) -> list[str]:
        onboarding = self.get_onboarding(workspace_id)
        filters: list[str] = []
        if onboarding.titles:
            filters.append(f"Titles: {', '.join(onboarding.titles)}")
        if onboarding.industries:
            filters.append(f"Industries: {', '.join(onboarding.industries)}")
        if onboarding.company_sizes:
            filters.append(f"Company sizes: {', '.join(onboarding.company_sizes)}")
        if onboarding.geos:
            filters.append(f"Geos: {', '.join(onboarding.geos)}")
        return filters

    def _strategy_questions_for_onboarding(
        self,
        onboarding: OnboardingProfile,
    ) -> list[str]:
        dynamic_questions: list[str] = []
        if not onboarding.target_customer.strip():
            dynamic_questions.append("Who exactly should PipeIQ target first?")
        if not onboarding.pain_points.strip():
            dynamic_questions.append("Which pain points create urgency in the first email?")
        if not onboarding.call_to_action.strip():
            dynamic_questions.append("What CTA should drive the first campaign?")
        if not onboarding.industries:
            dynamic_questions.append("Which industries should be included or excluded?")
        return dynamic_questions or [
            "Review your saved ICP and messaging inputs before running the first batch.",
            "Connect Apollo, Hunter, and Instantly to unlock prospecting, verification, and launch.",
            "Authorize Gmail or Google Calendar to prepare reply and meeting workflows.",
        ]

    def _render_subject(self, *, title: str, signal_type: str, product_name: str) -> str:
        if signal_type == "Funding":
            return f"Why funded teams still break outbound before it scales"
        if signal_type == "Hiring":
            return f"Hiring is usually a sign the outbound system is behind"
        if signal_type == "Product launch":
            return f"Your launch needs a sharper outbound angle than templates allow"
        return f"{product_name} for {title}s who need outbound that converts"

    def _render_body(
        self,
        *,
        contact_name: str,
        company: str,
        signal_type: str,
        pain_points: str,
        value_proposition: str,
        cta: str,
    ) -> str:
        signal_openers = {
            "Hiring": f"Saw {company} is expanding the team.",
            "Funding": f"Congrats on the recent momentum at {company}.",
            "Product launch": f"The new push at {company} stood out.",
        }
        opener = signal_openers.get(signal_type, f"Spent time looking at {company}.")
        return (
            f"Hi {contact_name.split()[0]} - {opener} The pattern we usually see next is "
            f"{pain_points}. {value_proposition} If that is relevant, worth {cta}?"
        )

    def _ingest_reply_received(
        self,
        workspace_id: str,
        event: InstantlyWebhookEvent,
    ) -> str:
        reply_text = (event.reply_text or event.email_text or event.reply_text_snippet or "").strip()
        classification = self._classify_reply(reply_text)
        if classification in {"UNSUBSCRIBE", "OUT_OF_OFFICE"}:
            return classification.lower()

        contact = self._match_contact_from_email(workspace_id, event.lead_email)
        reply_id = event.email_id or f"reply_{len(self._replies.get(workspace_id, [])) + 1}"
        queue = self._replies.setdefault(workspace_id, [])

        existing = next((reply for reply in queue if reply.id == reply_id), None)
        draft_reply = self._draft_reply_for_classification(classification, contact)
        summary = event.reply_text_snippet or reply_text[:140] or "Webhook reply received."

        if existing:
            existing.classification = classification
            existing.summary = summary
            existing.draft_reply = draft_reply
            existing.status = "pending"
            existing.confidence = self._confidence_for_classification(classification)
        else:
            queue.append(
                ReplyQueueItem(
                    id=reply_id,
                    workspace_id=workspace_id,
                    contact_id=contact.id if contact else "unknown_contact",
                    contact_name=contact.full_name if contact else self._fallback_contact_name(event),
                    company=contact.company if contact else "Unknown company",
                    classification=classification,
                    confidence=self._confidence_for_classification(classification),
                    summary=summary,
                    draft_reply=draft_reply,
                    status="pending",
                    requires_human=True,
                    received_at=event.timestamp or "2026-03-15T10:00:00+05:30",
                )
            )

        self._update_campaign_reply_metrics(workspace_id)
        return "reply_queued"

    def _ingest_lead_interested(
        self,
        workspace_id: str,
        event: InstantlyWebhookEvent,
    ) -> str:
        synthetic_event = InstantlyWebhookEvent(
            event_type="reply_received",
            timestamp=event.timestamp,
            campaign_id=event.campaign_id,
            lead_email=event.lead_email,
            email_id=event.email_id,
            reply_text=event.reply_text or "Interested in learning more and open to times next week.",
            reply_text_snippet=event.reply_text_snippet or "Interested and open to scheduling.",
        )
        return self._ingest_reply_received(workspace_id, synthetic_event)

    def _ingest_meeting_booked(
        self,
        workspace_id: str,
        event: InstantlyWebhookEvent,
    ) -> str:
        contact = self._match_contact_from_email(workspace_id, event.lead_email)
        if contact is None:
            return "meeting_ignored"

        meeting = self._ensure_meeting_prep(
            workspace_id=workspace_id,
            contact=contact,
            scheduled_for=event.timestamp or "2026-03-20T17:00:00+05:30",
        )
        meeting.status = "booked"
        campaign = self._campaigns.get(workspace_id)
        if campaign:
            campaign.meetings_booked = len(
                [item for item in self._meetings.get(workspace_id, []) if item.status == "booked"]
            )
        return "meeting_booked"

    def _promote_meeting_if_needed(self, workspace_id: str, reply: ReplyQueueItem) -> None:
        if reply.classification != "INTERESTED":
            return
        contact = next(
            (item for item in self._contacts.get(workspace_id, []) if item.id == reply.contact_id),
            None,
        )
        if contact is None:
            return
        meeting = self._ensure_meeting_prep(
            workspace_id=workspace_id,
            contact=contact,
            scheduled_for="2026-03-20T17:00:00+05:30",
        )
        meeting.status = "booked"
        campaign = self._campaigns.get(workspace_id)
        if campaign:
            campaign.meetings_booked = len(
                [item for item in self._meetings.get(workspace_id, []) if item.status == "booked"]
            )

    def _ensure_meeting_prep(
        self,
        *,
        workspace_id: str,
        contact: ContactPreview,
        scheduled_for: str,
    ) -> MeetingPrepItem:
        meetings = self._meetings.setdefault(workspace_id, [])
        for meeting in meetings:
            if meeting.contact_id == contact.id:
                return meeting

        meeting = MeetingPrepItem(
            id=f"meeting_{contact.id}",
            workspace_id=workspace_id,
            contact_id=contact.id,
            contact_name=contact.full_name,
            company=contact.company,
            scheduled_for=scheduled_for,
            status="prep_ready",
            prep_brief=[
                f"{contact.company} is already showing the signal PipeIQ used in outbound: {contact.signal_type}.",
                f"{contact.full_name} is a {contact.title} and likely cares about speed to launch plus reply handling.",
                "Lead with what changed since the first outbound touch and confirm the operational pain before pitching.",
            ],
            owner_note="Generated from the reply workflow after positive intent.",
        )
        meetings.append(meeting)
        return meeting

    def _match_contact_from_email(
        self,
        workspace_id: str,
        email: str | None,
    ) -> ContactPreview | None:
        if not email:
            return None
        normalized = email.strip().lower()
        for contact in self._contacts.get(workspace_id, []):
            if self._contact_email(contact) == normalized:
                return contact
        return None

    def _contact_email(self, contact: ContactPreview) -> str:
        return contact.email.strip().lower()

    def _fallback_contact_name(self, event: InstantlyWebhookEvent) -> str:
        if event.lead_email:
            return event.lead_email.split("@")[0].replace(".", " ").title()
        return "Unknown contact"

    def _classify_reply(self, text: str) -> Literal[
        "INTERESTED",
        "OBJECTION",
        "NOT_NOW",
        "REFERRAL",
        "OUT_OF_OFFICE",
        "UNSUBSCRIBE",
    ]:
        lowered = text.lower()
        if any(token in lowered for token in ["unsubscribe", "remove me", "stop emailing"]):
            return "UNSUBSCRIBE"
        if any(token in lowered for token in ["out of office", "ooo", "vacation", "away until"]):
            return "OUT_OF_OFFICE"
        if any(token in lowered for token in ["not now", "next quarter", "later", "circle back"]):
            return "NOT_NOW"
        if any(token in lowered for token in ["loop in", "speak with", "reach out to", "talk to"]):
            return "REFERRAL"
        if any(token in lowered for token in ["interested", "sounds good", "available", "book", "meeting", "call"]):
            return "INTERESTED"
        return "OBJECTION"

    def _draft_reply_for_classification(
        self,
        classification: str,
        contact: ContactPreview | None,
    ) -> str:
        first_name = contact.full_name.split()[0] if contact else "there"
        if classification == "INTERESTED":
            return (
                f"Thanks {first_name}. I can send two time options for next week and a short agenda so the call is useful from the start."
            )
        if classification == "NOT_NOW":
            return (
                f"Understood {first_name}. I will pause here and circle back at the timing that makes more sense for you."
            )
        if classification == "REFERRAL":
            return (
                f"Thanks {first_name}. If there is a better owner for this, feel free to point me in the right direction and I will keep the context tight."
            )
        return (
            f"Fair question {first_name}. PipeIQ sits on top of the tools you already use and handles the execution layer rather than asking you to replace your stack."
        )

    def _confidence_for_classification(self, classification: str) -> float:
        return {
            "INTERESTED": 0.96,
            "OBJECTION": 0.84,
            "NOT_NOW": 0.88,
            "REFERRAL": 0.82,
            "OUT_OF_OFFICE": 0.99,
            "UNSUBSCRIBE": 0.99,
        }[classification]

    def _update_campaign_reply_metrics(self, workspace_id: str) -> None:
        campaign = self._campaigns.get(workspace_id)
        if campaign is None or campaign.contacts_launched == 0:
            return
        replies = self._replies.get(workspace_id, [])
        interested = len([reply for reply in replies if reply.classification == "INTERESTED"])
        campaign.positive_replies = interested
        campaign.reply_rate = round((len(replies) / campaign.contacts_launched) * 100, 1)

    def _load_state(self) -> None:
        if not self._state_path.exists():
            return

        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return

        self._onboarding = {
            workspace_id: OnboardingProfile(**profile)
            for workspace_id, profile in payload.get("onboarding", {}).items()
        } or self._onboarding
        self._api_key_connections = payload.get("api_key_connections", self._api_key_connections)
        self._oauth_connections = payload.get("oauth_connections", self._oauth_connections)
        self._pipeline_generated = payload.get("pipeline_generated", self._pipeline_generated)
        self._launch_state = payload.get("launch_state", self._launch_state)
        self._instantly_webhooks = {
            workspace_id: InstantlyWebhookSubscription(**subscription)
            for workspace_id, subscription in payload.get("instantly_webhooks", {}).items()
        } or self._instantly_webhooks
        self._prospect_runs = {
            workspace_id: ProspectRunSummary(**run)
            for workspace_id, run in payload.get("prospect_runs", {}).items()
        } or self._prospect_runs
        self._campaigns = {
            workspace_id: CampaignSummary(**campaign)
            for workspace_id, campaign in payload.get("campaigns", {}).items()
        } or self._campaigns
        self._replies = {
            workspace_id: [ReplyQueueItem(**reply) for reply in replies]
            for workspace_id, replies in payload.get("replies", {}).items()
        } or self._replies
        self._meetings = {
            workspace_id: [MeetingPrepItem(**meeting) for meeting in meetings]
            for workspace_id, meetings in payload.get("meetings", {}).items()
        } or self._meetings
        self._contacts = {
            workspace_id: [ContactPreview(**contact) for contact in contacts]
            for workspace_id, contacts in payload.get("contacts", {}).items()
        } or self._contacts
        self._approvals = {
            workspace_id: [ApprovalItem(**approval) for approval in approvals]
            for workspace_id, approvals in payload.get("approvals", {}).items()
        } or self._approvals

    def _save_state(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "onboarding": {
                workspace_id: profile.model_dump()
                for workspace_id, profile in self._onboarding.items()
            },
            "api_key_connections": self._api_key_connections,
            "oauth_connections": self._oauth_connections,
            "pipeline_generated": self._pipeline_generated,
            "launch_state": self._launch_state,
            "instantly_webhooks": {
                workspace_id: subscription.model_dump()
                for workspace_id, subscription in self._instantly_webhooks.items()
            },
            "prospect_runs": {
                workspace_id: run.model_dump()
                for workspace_id, run in self._prospect_runs.items()
            },
            "campaigns": {
                workspace_id: campaign.model_dump()
                for workspace_id, campaign in self._campaigns.items()
            },
            "replies": {
                workspace_id: [reply.model_dump() for reply in replies]
                for workspace_id, replies in self._replies.items()
            },
            "meetings": {
                workspace_id: [meeting.model_dump() for meeting in meetings]
                for workspace_id, meetings in self._meetings.items()
            },
            "contacts": {
                workspace_id: [contact.model_dump() for contact in contacts]
                for workspace_id, contacts in self._contacts.items()
            },
            "approvals": {
                workspace_id: [approval.model_dump() for approval in approvals]
                for workspace_id, approvals in self._approvals.items()
            },
        }
        self._state_path.write_text(
            json.dumps(payload, indent=2),
            encoding="utf-8",
        )

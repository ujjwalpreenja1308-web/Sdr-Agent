from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MetricCard(BaseModel):
    label: str
    value: str
    caption: str


class BuildPhase(BaseModel):
    name: str
    duration: str
    outcome: str
    status: Literal["active", "next", "later"]


class ConnectionTarget(BaseModel):
    toolkit: str
    label: str
    category: Literal["required", "optional"]
    mode: Literal["oauth", "api_key"]
    description: str
    status: Literal["not_connected", "pending", "connected"]
    required_for_phase: str
    note: str | None = None
    connection_id: str | None = None


class WorkspaceSummary(BaseModel):
    id: str
    name: str
    greeting: str
    proposition: str
    phase_focus: str
    onboarding_completed: bool
    onboarding_progress: int
    metrics: list[MetricCard]
    phases: list[BuildPhase]
    strategy_questions: list[str]
    connections: list[ConnectionTarget]


class OnboardingProfile(BaseModel):
    workspace_id: str = "default"
    product_name: str = ""
    product_description: str = ""
    target_customer: str = ""
    value_proposition: str = ""
    pain_points: str = ""
    call_to_action: str = ""
    voice_guidelines: str = ""
    industries: list[str] = Field(default_factory=list)
    titles: list[str] = Field(default_factory=list)
    company_sizes: list[str] = Field(default_factory=list)
    geos: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)

    @property
    def completion_score(self) -> int:
        fields = [
            self.product_name,
            self.product_description,
            self.target_customer,
            self.value_proposition,
            self.pain_points,
            self.call_to_action,
            self.voice_guidelines,
            ",".join(self.industries),
            ",".join(self.titles),
            ",".join(self.company_sizes),
            ",".join(self.geos),
        ]
        completed = len([field for field in fields if field.strip()])
        return int((completed / len(fields)) * 100)

    @property
    def is_complete(self) -> bool:
        return self.completion_score >= 80


class PipelineMetric(BaseModel):
    label: str
    value: str
    caption: str
    tone: Literal["default", "success", "warning"]


class ContactPreview(BaseModel):
    id: str
    full_name: str
    email: str = ""
    title: str
    company: str
    signal_type: str
    signal_detail: str
    quality_score: int
    status: Literal["drafted", "ready_for_review", "approved_to_launch", "revision_requested"]
    email_verification_status: Literal["unverified", "valid", "risky", "invalid"] = "unverified"
    email_verification_score: float | None = None
    email_verification_note: str | None = None
    verification_checked_at: str | None = None
    subject: str
    body_preview: str


class ApprovalSample(BaseModel):
    contact_id: str
    contact_name: str
    company: str
    signal: str
    subject: str
    body: str


class ApprovalItem(BaseModel):
    id: str
    type: Literal["batch_send", "reply_review", "sequence_update"]
    title: str
    summary: str
    status: Literal["pending", "approved", "rejected"]
    priority: Literal["high", "medium", "low"]
    created_at: str
    sample_size: int
    samples: list[ApprovalSample]


class PipelineSnapshot(BaseModel):
    workspace_id: str
    metrics: list[PipelineMetric]
    contacts: list[ContactPreview]


class LaunchChecklistItem(BaseModel):
    id: str
    label: str
    detail: str
    status: Literal["complete", "pending"]


class LaunchReadiness(BaseModel):
    workspace_id: str
    ready_to_launch: bool
    progress: int
    stage: Literal["setup", "ready", "staged"]
    contacts_ready: int
    pending_approvals: int
    blockers: list[str]
    next_action: str
    checklist: list[LaunchChecklistItem]


class LaunchResult(BaseModel):
    workspace_id: str
    status: Literal["blocked", "staged"]
    campaign_name: str | None
    campaign_id: str | None = None
    provider: str | None = None
    mode: Literal["live", "mock"] | None = None
    contacts_launched: int
    message: str
    blockers: list[str]


class CampaignSummary(BaseModel):
    workspace_id: str
    status: Literal["idle", "staged", "running"]
    campaign_name: str | None = None
    campaign_id: str | None = None
    provider: str
    mode: Literal["live", "mock"]
    contacts_launched: int
    reply_rate: float
    positive_replies: int
    meetings_booked: int
    last_sync_at: str


class ReplyQueueItem(BaseModel):
    id: str
    workspace_id: str
    contact_id: str
    contact_name: str
    company: str
    classification: Literal[
        "INTERESTED",
        "OBJECTION",
        "NOT_NOW",
        "REFERRAL",
        "OUT_OF_OFFICE",
        "UNSUBSCRIBE",
    ]
    confidence: float
    summary: str
    draft_reply: str
    status: Literal["pending", "approved", "sent", "dismissed"]
    requires_human: bool
    received_at: str


class MeetingPrepItem(BaseModel):
    id: str
    workspace_id: str
    contact_id: str
    contact_name: str
    company: str
    scheduled_for: str
    status: Literal["prep_ready", "booked"]
    prep_brief: list[str]
    owner_note: str


class ReplyDecisionRequest(BaseModel):
    decision: Literal["approved", "dismissed"]


class InstantlyWebhookSubscription(BaseModel):
    workspace_id: str
    configured: bool
    webhook_id: str | None = None
    target_url: str | None = None
    event_type: str = "reply_received"
    secret_configured: bool = False


class InstantlyWebhookRegistrationRequest(BaseModel):
    workspace_id: str = Field(default="default")
    target_url: str


class InstantlyWebhookEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    timestamp: str | None = None
    event_type: str
    workspace: str | None = None
    campaign_id: str | None = None
    campaign_name: str | None = None
    lead_email: str | None = None
    email_account: str | None = None
    unibox_url: str | None = None
    step: int | None = None
    variant: int | None = None
    is_first: bool | None = None
    email_id: str | None = None
    email_subject: str | None = None
    email_text: str | None = None
    email_html: str | None = None
    reply_text_snippet: str | None = None
    reply_subject: str | None = None
    reply_text: str | None = None
    reply_html: str | None = None


class WebhookReceipt(BaseModel):
    workspace_id: str
    event_type: str
    accepted: bool
    action: str


class ProspectRunSummary(BaseModel):
    workspace_id: str
    status: Literal["idle", "completed"]
    mode: Literal["live", "mock"]
    sourced_count: int
    enriched_count: int
    deduped_count: int
    filters: list[str]
    note: str
    last_run_at: str


class ProspectVerificationRequest(BaseModel):
    external_user_id: str


class IntegrationCheckRequest(BaseModel):
    external_user_id: str | None = None


class IntegrationCheckResult(BaseModel):
    workspace_id: str
    toolkit: str
    connection_status: Literal["not_connected", "pending", "connected", "error"]
    source: Literal["composio"]
    summary: str
    details: list[str]
    checked_at: str


class OAuthConnectionRequest(BaseModel):
    workspace_id: str = Field(default="default")
    external_user_id: str
    toolkit: str
    callback_url: str | None = None


class ApiKeyConnectionRequest(BaseModel):
    workspace_id: str = Field(default="default")
    external_user_id: str
    toolkit: str
    label: str
    secret_hint: str = Field(
        description="A masked or labelled value. The scaffold stores only the hint."
    )


class ConnectionLaunch(BaseModel):
    toolkit: str
    session_id: str
    connection_id: str
    redirect_url: str | None
    status: str
    mode: Literal["oauth", "api_key"]
    note: str | None = None


class ConnectionStatus(BaseModel):
    toolkit: str
    connection_id: str | None
    status: Literal["not_connected", "pending", "connected"]
    mode: Literal["oauth", "api_key"]
    note: str | None = None


class AgentChatRequest(BaseModel):
    workspace_id: str = Field(default="default")
    external_user_id: str
    prompt: str


class AgentChatResponse(BaseModel):
    response: str
    connected_toolkits: list[str]
    model_mode: Literal["live", "offline"]


class ApprovalDecisionRequest(BaseModel):
    decision: Literal["approved", "rejected"]

from __future__ import annotations

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .agent_runtime import PipeIQAgentRuntime
from .apollo_service import ApolloService
from .config import get_settings
from .composio_service import ComposioService
from .hunter_service import HunterVerificationService
from .integration_service import IntegrationDiagnosticsService
from .instantly_service import InstantlyLaunchPayload, InstantlyService
from .models import (
    AgentChatRequest,
    AgentChatResponse,
    ApiKeyConnectionRequest,
    CampaignSummary,
    InstantlyWebhookEvent,
    InstantlyWebhookRegistrationRequest,
    InstantlyWebhookSubscription,
    IntegrationCheckRequest,
    IntegrationCheckResult,
    LaunchReadiness,
    LaunchResult,
    MeetingPrepItem,
    OnboardingProfile,
    ApprovalDecisionRequest,
    ApprovalItem,
    ConnectionLaunch,
    ConnectionStatus,
    ContactPreview,
    PipelineSnapshot,
    ProspectVerificationRequest,
    ProspectRunSummary,
    ReplyDecisionRequest,
    ReplyQueueItem,
    WebhookReceipt,
    OAuthConnectionRequest,
    WorkspaceSummary,
)
from .store import InMemoryStore


settings = get_settings()
store = InMemoryStore()
composio_service = ComposioService(settings)
instantly_service = InstantlyService(composio_service)
apollo_service = ApolloService(composio_service)
hunter_service = HunterVerificationService(composio_service)
integration_service = IntegrationDiagnosticsService(composio_service)
agent_runtime = PipeIQAgentRuntime(
    settings=settings,
    store=store,
    composio_service=composio_service,
)

app = FastAPI(
    title="PipeIQ Agent API",
    version="0.1.0",
    description="Scaffold API for PipeIQ onboarding, Composio connection flows, and OpenAI agent orchestration.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.app_env}


@app.get("/api/workspaces/{workspace_id}", response_model=WorkspaceSummary)
def get_workspace(workspace_id: str) -> WorkspaceSummary:
    try:
        return store.get_workspace(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post(
    "/api/integrations/{workspace_id}/{toolkit}/check",
    response_model=IntegrationCheckResult,
)
def check_integration(
    workspace_id: str,
    toolkit: str,
    payload: IntegrationCheckRequest,
) -> IntegrationCheckResult:
    try:
        workspace = store.get_workspace(workspace_id)
        connection = next(
            (item for item in workspace.connections if item.toolkit == toolkit),
            None,
        )
        if connection is None:
            raise HTTPException(status_code=404, detail=f"Unknown toolkit: {toolkit}")

        execution_user_id = (
            store.execution_user_id_for_toolkit(workspace_id, toolkit)
            or payload.external_user_id
        )
        connected_account_id = store.connected_account_for_toolkit(workspace_id, toolkit)
        return integration_service.check_toolkit(
            workspace_id=workspace_id,
            toolkit=toolkit,
            connection_status=connection.status,
            external_user_id=execution_user_id,
            connected_account_id=connected_account_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/onboarding/{workspace_id}", response_model=OnboardingProfile)
def get_onboarding(workspace_id: str) -> OnboardingProfile:
    try:
        return store.get_onboarding(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/api/onboarding/{workspace_id}", response_model=OnboardingProfile)
def update_onboarding(workspace_id: str, payload: OnboardingProfile) -> OnboardingProfile:
    try:
        return store.update_onboarding(workspace_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/pipeline/{workspace_id}", response_model=PipelineSnapshot)
def get_pipeline(workspace_id: str) -> PipelineSnapshot:
    try:
        return store.get_pipeline(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/prospects/{workspace_id}", response_model=ProspectRunSummary)
def get_prospect_run(workspace_id: str) -> ProspectRunSummary:
    try:
        return store.get_prospect_run(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/prospects/{workspace_id}/run", response_model=ProspectRunSummary)
def run_prospect_search(workspace_id: str) -> ProspectRunSummary:
    try:
        onboarding = store.get_onboarding(workspace_id)
        if not onboarding.is_complete:
            raise HTTPException(
                status_code=400,
                detail="Complete onboarding before running Apollo prospecting.",
            )

        apollo_account_id = store.connected_account_for_toolkit(workspace_id, "apollo")
        apollo_user_id = store.execution_user_id_for_toolkit(workspace_id, "apollo")
        if not apollo_account_id or not apollo_user_id:
            raise HTTPException(
                status_code=400,
                detail="Connect Apollo through Composio before running prospecting.",
            )

        result = apollo_service.run_prospect_search(
            external_user_id=apollo_user_id,
            connected_account_id=apollo_account_id,
            onboarding=onboarding,
        )
        contacts = [
            ContactPreview(
                id=f"contact_{workspace_id}_{index + 1}",
                full_name=prospect.full_name,
                email=prospect.email,
                title=prospect.title,
                company=prospect.company,
                signal_type=prospect.signal_type,
                signal_detail=prospect.signal_detail,
                quality_score=prospect.quality_score,
                status="drafted",
                email_verification_status="unverified",
                subject="Awaiting personalization",
                body_preview="Prospect sourced and enriched. Generate the batch to create the pre-rendered sequence.",
            )
            for index, prospect in enumerate(result.prospects)
        ]
        return store.apply_prospect_run(
            workspace_id=workspace_id,
            mode=result.mode,
            sourced_count=result.sourced_count,
            enriched_count=result.enriched_count,
            note=result.note,
            contacts=contacts,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/prospects/{workspace_id}/verify-emails", response_model=PipelineSnapshot)
def verify_prospect_emails(
    workspace_id: str,
    payload: ProspectVerificationRequest,
) -> PipelineSnapshot:
    try:
        if store.get_prospect_run(workspace_id).status != "completed":
            raise HTTPException(status_code=400, detail="Run Apollo prospecting before verification.")

        connected_accounts = store.connected_accounts_for_agent(workspace_id)
        hunter_account_id = connected_accounts.get("hunter")
        hunter_user_id = store.execution_user_id_for_toolkit(workspace_id, "hunter") or payload.external_user_id
        if not hunter_account_id or not hunter_user_id:
            raise HTTPException(
                status_code=400,
                detail="Connect Hunter through Composio before verifying emails.",
            )

        contacts = store.get_pipeline(workspace_id).contacts
        results = [
            hunter_service.verify_email(
                external_user_id=hunter_user_id,
                connected_account_id=hunter_account_id,
                email=contact.email,
            )
            for contact in contacts
            if contact.email.strip()
        ]
        return store.apply_email_verifications(
            workspace_id=workspace_id,
            results=[
                {
                    "email": result.email,
                    "status": result.status,
                    "score": result.score,
                    "note": result.note,
                    "checked_at": result.checked_at,
                }
                for result in results
            ],
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/pipeline/{workspace_id}/generate", response_model=PipelineSnapshot)
def generate_pipeline(workspace_id: str) -> PipelineSnapshot:
    try:
        return store.generate_pipeline_from_onboarding(workspace_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/launch/{workspace_id}/readiness", response_model=LaunchReadiness)
def launch_readiness(workspace_id: str) -> LaunchReadiness:
    try:
        return store.get_launch_readiness(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/launch/{workspace_id}", response_model=LaunchResult)
def stage_launch(workspace_id: str) -> LaunchResult:
    try:
        contacts = store.launch_contacts(workspace_id)
        if not contacts:
            return store.complete_launch(
                workspace_id=workspace_id,
                campaign_id="",
                campaign_name="",
                contacts_launched=0,
                provider="instantly",
                mode="mock",
            )
        instantly_account_id = store.connected_account_for_toolkit(workspace_id, "instantly")
        instantly_user_id = store.execution_user_id_for_toolkit(workspace_id, "instantly")
        if not instantly_account_id or not instantly_user_id:
            raise HTTPException(
                status_code=400,
                detail="Connect Instantly through Composio before staging the campaign.",
            )
        workspace = store.get_workspace(workspace_id)
        first_contact = contacts[0]
        launch = instantly_service.launch_campaign(
            external_user_id=instantly_user_id,
            connected_account_id=instantly_account_id,
            payload=InstantlyLaunchPayload(
                campaign_name=f"{workspace.name} - First Outbound Wave",
                contacts=[
                    {
                        "email": contact.email,
                        "first_name": contact.full_name.split()[0],
                        "last_name": contact.full_name.split()[-1],
                        "company_name": contact.company,
                        "personalization": contact.body_preview,
                    }
                    for contact in contacts
                ],
                sequence_subject=first_contact.subject,
                sequence_body=first_contact.body_preview,
            ),
        )
        return store.complete_launch(
            workspace_id=workspace_id,
            campaign_id=launch.campaign_id,
            campaign_name=launch.campaign_name,
            contacts_launched=launch.contacts_launched,
            provider=launch.provider,
            mode=launch.mode,  # type: ignore[arg-type]
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/campaigns/{workspace_id}", response_model=CampaignSummary)
def get_campaign(workspace_id: str) -> CampaignSummary:
    try:
        return store.get_campaign(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/webhooks/instantly/{workspace_id}", response_model=InstantlyWebhookSubscription)
def get_instantly_webhook(workspace_id: str) -> InstantlyWebhookSubscription:
    try:
        return store.get_instantly_webhook(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post(
    "/api/webhooks/instantly/register",
    response_model=InstantlyWebhookSubscription,
)
def register_instantly_webhook(
    payload: InstantlyWebhookRegistrationRequest,
) -> InstantlyWebhookSubscription:
    try:
        instantly_account_id = store.connected_account_for_toolkit(payload.workspace_id, "instantly")
        instantly_user_id = store.execution_user_id_for_toolkit(payload.workspace_id, "instantly")
        if not instantly_account_id or not instantly_user_id:
            raise HTTPException(
                status_code=400,
                detail="Connect Instantly through Composio before registering the webhook.",
            )
        result = instantly_service.register_reply_webhook(
            external_user_id=instantly_user_id,
            connected_account_id=instantly_account_id,
            target_url=payload.target_url,
        )
        return store.set_instantly_webhook(
            workspace_id=payload.workspace_id,
            webhook_id=result.webhook_id,
            target_url=result.target_url,
            secret_configured=False,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/replies/{workspace_id}", response_model=list[ReplyQueueItem])
def list_replies(workspace_id: str) -> list[ReplyQueueItem]:
    try:
        return store.list_replies(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/replies/{reply_id}/decision", response_model=ReplyQueueItem)
def decide_reply(reply_id: str, payload: ReplyDecisionRequest) -> ReplyQueueItem:
    try:
        return store.decide_reply(
            workspace_id="default",
            reply_id=reply_id,
            decision=payload.decision,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/meetings/{workspace_id}", response_model=list[MeetingPrepItem])
def list_meetings(workspace_id: str) -> list[MeetingPrepItem]:
    try:
        return store.list_meetings(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/webhooks/instantly", response_model=WebhookReceipt)
def instantly_webhook(
    payload: InstantlyWebhookEvent,
    x_pipeiq_webhook_secret: str | None = Header(default=None),
) -> WebhookReceipt:
    if settings.instantly_webhook_secret and x_pipeiq_webhook_secret != settings.instantly_webhook_secret:
        raise HTTPException(status_code=401, detail="Invalid webhook secret.")

    workspace_id = payload.workspace or "default"
    try:
        return store.ingest_instantly_event(workspace_id=workspace_id, event=payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/approvals/{workspace_id}", response_model=list[ApprovalItem])
def list_approvals(workspace_id: str) -> list[ApprovalItem]:
    try:
        return store.list_approvals(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/approvals/{approval_id}/decision", response_model=ApprovalItem)
def decide_approval(approval_id: str, payload: ApprovalDecisionRequest) -> ApprovalItem:
    try:
        return store.decide_approval(
            workspace_id="default",
            approval_id=approval_id,
            decision=payload.decision,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/connections/authorize", response_model=ConnectionLaunch)
def authorize_connection(payload: OAuthConnectionRequest) -> ConnectionLaunch:
    try:
        launch = composio_service.start_manual_oauth(
            external_user_id=payload.external_user_id,
            toolkit=payload.toolkit,
            callback_url=payload.callback_url,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - surfacing SDK errors verbatim is useful in the scaffold
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    store.record_oauth_start(
        workspace_id=payload.workspace_id,
        external_user_id=payload.external_user_id,
        toolkit=payload.toolkit,
        connection_id=launch.connection_id,
        session_id=launch.session_id,
        note="Connection launched. Poll the connection endpoint until the account becomes ACTIVE.",
    )
    return ConnectionLaunch(
        toolkit=payload.toolkit,
        session_id=launch.session_id,
        connection_id=launch.connection_id,
        redirect_url=launch.redirect_url,
        status="pending",
        mode="oauth",
        note="manage_connections is disabled. Users complete the Composio Connect flow through the returned redirect URL.",
    )


@app.post("/api/connections/api-key", response_model=ConnectionStatus)
def save_api_key_connection(payload: ApiKeyConnectionRequest) -> ConnectionStatus:
    return store.record_api_key(
        workspace_id=payload.workspace_id,
        toolkit=payload.toolkit,
        label=payload.label,
        secret_hint=payload.secret_hint,
    )


@app.get("/api/connections/{connection_id}", response_model=ConnectionStatus)
def connection_status(connection_id: str) -> ConnectionStatus:
    lookup = store.find_oauth_by_connection_id(connection_id)
    if lookup is None:
        raise HTTPException(status_code=404, detail="Unknown connection id.")

    workspace_id, toolkit = lookup

    try:
        connection = composio_service.fetch_connection(connection_id)
        if connection.status == "ACTIVE":
            return store.set_oauth_status(
                workspace_id=workspace_id,
                toolkit=toolkit,
                status="connected",
                note="Connected through Composio.",
            )
        return store.set_oauth_status(
            workspace_id=workspace_id,
            toolkit=toolkit,
            status="pending",
            note=f"Current Composio status: {connection.status}",
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        return store.set_oauth_status(
            workspace_id=workspace_id,
            toolkit=toolkit,
            status="pending",
            note=f"Unable to confirm yet: {exc}",
        )


@app.post("/api/agents/chat", response_model=AgentChatResponse)
async def chat(payload: AgentChatRequest) -> AgentChatResponse:
    try:
        return await agent_runtime.run_chat(
            workspace_id=payload.workspace_id,
            external_user_id=payload.external_user_id,
            prompt=payload.prompt,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc

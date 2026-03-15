from __future__ import annotations

import os

from agents import Agent, Runner, function_tool

from .config import Settings
from .composio_service import ComposioService
from .models import AgentChatResponse
from .store import InMemoryStore


class PipeIQAgentRuntime:
    def __init__(
        self,
        *,
        settings: Settings,
        store: InMemoryStore,
        composio_service: ComposioService,
    ) -> None:
        self._settings = settings
        self._store = store
        self._composio_service = composio_service
        if self._settings.openai_api_key:
            os.environ.setdefault("OPENAI_API_KEY", self._settings.openai_api_key)

    async def run_chat(
        self,
        *,
        workspace_id: str,
        external_user_id: str,
        prompt: str,
    ) -> AgentChatResponse:
        connected_accounts = self._store.connected_accounts_for_agent(workspace_id)
        connected_toolkits = self._store.connected_toolkits_for_user(workspace_id)

        if not self._settings.openai_api_key:
            return AgentChatResponse(
                response=self._offline_response(
                    workspace_id=workspace_id,
                    prompt=prompt,
                    connected_toolkits=connected_toolkits,
                ),
                connected_toolkits=connected_toolkits,
                model_mode="offline",
            )

        composio_tools = []
        if self._composio_service.enabled and connected_accounts:
            composio_tools = self._composio_service.build_agent_tools(
                external_user_id=external_user_id,
                connected_accounts=connected_accounts,
            )

        workspace = self._store.get_workspace(workspace_id)
        onboarding = self._store.get_onboarding(workspace_id)
        prospect_run = self._store.get_prospect_run(workspace_id)
        pipeline = self._store.get_pipeline(workspace_id)
        campaign = self._store.get_campaign(workspace_id)
        replies = self._store.list_replies(workspace_id)
        meetings = self._store.list_meetings(workspace_id)
        approvals = self._store.list_approvals(workspace_id)

        @function_tool
        def read_pipeline(filters: str = "") -> str:
            """Read the current outbound pipeline summary for this workspace."""
            summary_lines = [
                f"- {metric.label}: {metric.value} ({metric.caption})"
                for metric in pipeline.metrics
            ]
            if filters:
                summary_lines.append(f"- Requested filter: {filters}")
            return "\n".join(summary_lines)

        @function_tool
        def list_connection_status() -> str:
            """Inspect the current integration status for this workspace."""
            items = [
                f"- {connection.label}: {connection.status.replace('_', ' ')}"
                for connection in workspace.connections
            ]
            return "\n".join(items)

        @function_tool
        def list_pending_approvals() -> str:
            """Summarize approval queue items that are still blocking outbound launch."""
            pending = [approval for approval in approvals if approval.status == "pending"]
            if not pending:
                return "No pending approvals."
            return "\n".join(
                [
                    f"- {approval.title}: {approval.summary} ({approval.sample_size} samples)"
                    for approval in pending
                ]
            )

        @function_tool
        def read_campaign_state() -> str:
            """Read the current campaign, reply, and meeting state for this workspace."""
            return "\n".join(
                [
                    f"- Campaign status: {campaign.status}",
                    f"- Contacts launched: {campaign.contacts_launched}",
                    f"- Positive replies: {campaign.positive_replies}",
                    f"- Meetings booked: {campaign.meetings_booked}",
                    f"- Reply queue items: {len(replies)}",
                    f"- Meeting prep items: {len(meetings)}",
                ]
            )

        @function_tool
        def read_strategy_profile() -> str:
            """Read the saved onboarding, ICP, and messaging profile for this workspace."""
            return "\n".join(
                [
                    f"- Product: {onboarding.product_name or 'not set'}",
                    f"- Description: {onboarding.product_description or 'not set'}",
                    f"- Target customer: {onboarding.target_customer or 'not set'}",
                    f"- Value proposition: {onboarding.value_proposition or 'not set'}",
                    f"- Pain points: {onboarding.pain_points or 'not set'}",
                    f"- CTA: {onboarding.call_to_action or 'not set'}",
                    f"- Prospect run: {prospect_run.status} ({prospect_run.mode})",
                ]
            )

        @function_tool
        def suggest_next_action() -> str:
            """Return the best next build action based on the scaffold state."""
            pending_count = len([approval for approval in approvals if approval.status == "pending"])
            return (
                "Complete onboarding first, connect Apollo, Hunter, and Instantly, run Apollo prospecting, verify sourced emails, generate the personalized batch, "
                "approve it, launch the first Instantly campaign, then clear the reply queue and prep the next meeting. "
                f"Pending approvals: {pending_count}. Prospecting status: {prospect_run.status}. Running campaign status: {campaign.status}."
            )

        instructions = (
            "You are PipeIQ, an autonomous outbound operator. "
            "Be concise, operational, and bias toward concrete next actions. "
            "Only claim actions were completed if a tool actually did them. "
            f"The active workspace is {workspace.name}. "
            f"The current phase focus is: {workspace.phase_focus}"
        )

        agent = Agent(
            name="PipeIQ SDR",
            model=self._settings.openai_model,
            instructions=instructions,
            tools=[
                read_pipeline,
                read_strategy_profile,
                read_campaign_state,
                list_connection_status,
                list_pending_approvals,
                suggest_next_action,
                *composio_tools,
            ],
        )
        result = await Runner.run(agent, prompt)
        output = result.final_output if isinstance(result.final_output, str) else str(result.final_output)
        return AgentChatResponse(
            response=output,
            connected_toolkits=connected_toolkits,
            model_mode="live",
        )

    def _offline_response(
        self,
        *,
        workspace_id: str,
        prompt: str,
        connected_toolkits: list[str],
    ) -> str:
        workspace = self._store.get_workspace(workspace_id)
        return (
            "OpenAI is not configured yet, so this is the scaffold fallback.\n\n"
            f"Prompt received: {prompt}\n"
            f"Workspace: {workspace.name}\n"
            f"Connected toolkits: {', '.join(connected_toolkits) if connected_toolkits else 'none'}\n\n"
            "Recommended next step: connect Apollo, Hunter, and Instantly, then authorize Gmail or Google Calendar "
            "through the Composio flow to unlock live agent actions."
        )

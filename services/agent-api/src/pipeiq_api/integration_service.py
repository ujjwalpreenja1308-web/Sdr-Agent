from __future__ import annotations

from typing import Any

from .composio_service import ComposioService
from .models import IntegrationCheckResult


class IntegrationDiagnosticsService:
    def __init__(self, composio_service: ComposioService) -> None:
        self._composio_service = composio_service
        self._tool_map: dict[str, tuple[str, dict[str, object], str]] = {
            "apollo": (
                "APOLLO_GET_AUTH_STATUS",
                {},
                "Apollo connection responded through Composio.",
            ),
            "hunter": (
                "HUNTER_ACCOUNT_INFORMATION",
                {},
                "Hunter account responded through Composio.",
            ),
            "instantly": (
                "INSTANTLY_GET_CURRENT_WORKSPACE",
                {},
                "Instantly workspace responded through Composio.",
            ),
            "gmail": (
                "GMAIL_GET_PROFILE",
                {},
                "Gmail account responded through Composio.",
            ),
            "googlecalendar": (
                "GOOGLECALENDAR_LIST_CALENDARS",
                {},
                "Google Calendar responded through Composio.",
            ),
            "hubspot": (
                "HUBSPOT_GET_USER",
                {},
                "HubSpot account responded through Composio.",
            ),
        }

    def check_toolkit(
        self,
        *,
        workspace_id: str,
        toolkit: str,
        connection_status: str,
        external_user_id: str | None,
        connected_account_id: str | None,
    ) -> IntegrationCheckResult:
        if connection_status == "not_connected":
            return IntegrationCheckResult(
                workspace_id=workspace_id,
                toolkit=toolkit,
                connection_status="not_connected",
                source="composio",
                summary="No Composio connection exists for this toolkit yet.",
                details=[],
                checked_at="2026-03-15T18:00:00+05:30",
            )
        if connection_status == "pending":
            return IntegrationCheckResult(
                workspace_id=workspace_id,
                toolkit=toolkit,
                connection_status="pending",
                source="composio",
                summary="Connection is still pending inside Composio.",
                details=[],
                checked_at="2026-03-15T18:00:00+05:30",
            )
        if not external_user_id or not connected_account_id:
            return IntegrationCheckResult(
                workspace_id=workspace_id,
                toolkit=toolkit,
                connection_status="error",
                source="composio",
                summary="Connection metadata is incomplete for execution.",
                details=[],
                checked_at="2026-03-15T18:00:00+05:30",
            )

        tool_config = self._tool_map.get(toolkit)
        if not tool_config:
            return IntegrationCheckResult(
                workspace_id=workspace_id,
                toolkit=toolkit,
                connection_status="error",
                source="composio",
                summary="No diagnostics action is configured for this toolkit yet.",
                details=[],
                checked_at="2026-03-15T18:00:00+05:30",
            )

        tool_slug, arguments, summary = tool_config
        try:
            payload = self._composio_service.execute_tool(
                external_user_id=external_user_id,
                toolkit=toolkit,
                connected_account_id=connected_account_id,
                tool_slug=tool_slug,
                arguments=arguments,
            )
        except Exception as exc:
            return IntegrationCheckResult(
                workspace_id=workspace_id,
                toolkit=toolkit,
                connection_status="error",
                source="composio",
                summary=f"{toolkit.title()} diagnostics failed through Composio.",
                details=[str(exc)],
                checked_at="2026-03-15T18:00:00+05:30",
            )

        details = self._extract_details(payload)
        return IntegrationCheckResult(
            workspace_id=workspace_id,
            toolkit=toolkit,
            connection_status="connected",
            source="composio",
            summary=summary,
            details=details,
            checked_at="2026-03-15T18:00:00+05:30",
        )

    def _extract_details(self, payload: Any) -> list[str]:
        plain = self._to_plain(payload)
        details: list[str] = []
        self._walk(plain, details, path="")
        return details[:6]

    def _walk(self, value: Any, details: list[str], *, path: str) -> None:
        if len(details) >= 6:
            return
        if isinstance(value, dict):
            for key, inner in value.items():
                next_path = f"{path}.{key}" if path else str(key)
                self._walk(inner, details, path=next_path)
                if len(details) >= 6:
                    return
            return
        if isinstance(value, list):
            for index, inner in enumerate(value[:3]):
                next_path = f"{path}[{index}]"
                self._walk(inner, details, path=next_path)
                if len(details) >= 6:
                    return
            return
        if value in (None, "", [], {}):
            return
        if isinstance(value, (str, int, float, bool)):
            details.append(f"{path}: {value}")

    def _to_plain(self, payload: Any) -> Any:
        if hasattr(payload, "model_dump"):
            return payload.model_dump()
        if hasattr(payload, "to_dict"):
            return payload.to_dict()
        return payload

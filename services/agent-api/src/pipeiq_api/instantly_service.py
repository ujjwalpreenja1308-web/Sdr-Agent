from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from .composio_service import ComposioService


@dataclass
class InstantlyLaunchPayload:
    campaign_name: str
    contacts: list[dict[str, str]]
    sequence_subject: str
    sequence_body: str


@dataclass
class InstantlyLaunchResult:
    campaign_id: str
    campaign_name: str
    contacts_launched: int
    provider: str
    mode: Literal["live", "mock"]


@dataclass
class InstantlyWebhookResult:
    webhook_id: str
    target_url: str
    event_type: str


class InstantlyService:
    def __init__(self, composio_service: ComposioService) -> None:
        self._composio_service = composio_service

    def launch_campaign(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
        payload: InstantlyLaunchPayload,
    ) -> InstantlyLaunchResult:
        sending_accounts = self._list_accounts(
            external_user_id=external_user_id,
            connected_account_id=connected_account_id,
        )
        campaign_id = self._create_campaign(
            external_user_id=external_user_id,
            connected_account_id=connected_account_id,
            payload=payload,
            sending_accounts=sending_accounts,
        )
        self._add_leads(
            external_user_id=external_user_id,
            connected_account_id=connected_account_id,
            campaign_id=campaign_id,
            contacts=payload.contacts,
        )
        self._activate_campaign(
            external_user_id=external_user_id,
            connected_account_id=connected_account_id,
            campaign_id=campaign_id,
        )
        return InstantlyLaunchResult(
            campaign_id=campaign_id,
            campaign_name=payload.campaign_name,
            contacts_launched=len(payload.contacts),
            provider="instantly",
            mode="live",
        )

    def register_reply_webhook(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
        target_url: str,
    ) -> InstantlyWebhookResult:
        response = self._composio_service.execute_tool(
            external_user_id=external_user_id,
            toolkit="instantly",
            connected_account_id=connected_account_id,
            tool_slug="INSTANTLY_CREATE_WEBHOOK",
            arguments={
                "target_hook_url": target_url,
                "event_type": "all_events",
            },
        )
        payload = self._extract_dict(response)
        webhook_id = self._extract_str(payload, ["id", "_id", "webhook_id"])
        if not webhook_id:
            raise RuntimeError("Instantly webhook registration did not return a webhook id.")
        return InstantlyWebhookResult(
            webhook_id=webhook_id,
            target_url=target_url,
            event_type="all_events",
        )

    def _create_campaign(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
        payload: InstantlyLaunchPayload,
        sending_accounts: list[str],
    ) -> str:
        today = datetime.now(timezone.utc)
        tomorrow = today + timedelta(days=1)
        campaign_payload: dict[str, object] = {
            "name": payload.campaign_name,
            "campaign_schedule": {
                "start_date": today.date().isoformat(),
                "end_date": tomorrow.date().isoformat(),
                "schedules": [
                    {
                        "name": "PipeIQ workday",
                        "timing": {"from": "09:00", "to": "17:00"},
                        "days": {
                            "0": False,
                            "1": True,
                            "2": True,
                            "3": True,
                            "4": True,
                            "5": True,
                            "6": False,
                        },
                        "timezone": "America/Detroit",
                    }
                ],
            },
            "sequences": [
                {
                    "steps": [
                        {
                            "type": "email",
                            "delay": 0,
                            "variants": [
                                {
                                    "subject": payload.sequence_subject,
                                    "body": payload.sequence_body,
                                }
                            ],
                        }
                    ]
                }
            ],
            "stop_on_reply": True,
            "stop_on_auto_reply": True,
            "allow_risky_contacts": True,
        }
        if sending_accounts:
            campaign_payload["email_list"] = sending_accounts

        response = self._composio_service.execute_tool(
            external_user_id=external_user_id,
            toolkit="instantly",
            connected_account_id=connected_account_id,
            tool_slug="INSTANTLY_CREATE_CAMPAIGN",
            arguments=campaign_payload,
        )
        parsed = self._extract_dict(response)
        campaign_id = self._extract_str(parsed, ["id", "_id", "campaign_id"])
        if not campaign_id:
            raise RuntimeError("Instantly campaign creation did not return a campaign id.")
        return campaign_id

    def _add_leads(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
        campaign_id: str,
        contacts: list[dict[str, str]],
    ) -> None:
        leads = []
        for contact in contacts:
            lead = {
                "email": contact["email"],
                "first_name": contact.get("first_name", ""),
                "last_name": contact.get("last_name", ""),
                "company_name": contact.get("company_name", ""),
                "personalization": contact.get("personalization", ""),
            }
            leads.append(lead)

        self._composio_service.execute_tool(
            external_user_id=external_user_id,
            toolkit="instantly",
            connected_account_id=connected_account_id,
            tool_slug="INSTANTLY_ADD_LEADS_BULK",
            arguments={
                "campaign_id": campaign_id,
                "leads": leads,
                "skip_if_in_campaign": True,
                "skip_if_in_workspace": True,
            },
        )

    def _activate_campaign(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
        campaign_id: str,
    ) -> None:
        self._composio_service.execute_tool(
            external_user_id=external_user_id,
            toolkit="instantly",
            connected_account_id=connected_account_id,
            tool_slug="INSTANTLY_ACTIVATE_CAMPAIGN",
            arguments={"id": campaign_id},
        )

    def _list_accounts(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
    ) -> list[str]:
        response = self._composio_service.execute_tool(
            external_user_id=external_user_id,
            toolkit="instantly",
            connected_account_id=connected_account_id,
            tool_slug="INSTANTLY_LIST_ACCOUNTS",
            arguments={"limit": 5},
        )
        accounts = self._extract_list(response)
        emails: list[str] = []
        for account in accounts:
            email = self._extract_str(account, ["email", "address"])
            if email:
                emails.append(email)
        return emails

    def _extract_dict(self, payload: Any) -> dict[str, Any]:
        current = self._to_plain(payload)
        candidates = [current]
        while candidates:
            item = candidates.pop(0)
            if isinstance(item, dict):
                if item.get("id") or item.get("_id") or item.get("campaign_id") or item.get("webhook_id"):
                    return item
                candidates.extend(item.values())
            elif isinstance(item, list):
                candidates.extend(item)
        return current if isinstance(current, dict) else {}

    def _extract_list(self, payload: Any) -> list[dict[str, Any]]:
        current = self._to_plain(payload)
        candidates = [current]
        while candidates:
            item = candidates.pop(0)
            if isinstance(item, dict):
                for key in ("items", "accounts", "data", "results"):
                    value = item.get(key)
                    if isinstance(value, list):
                        return [entry for entry in value if isinstance(entry, dict)]
                    if isinstance(value, dict):
                        candidates.append(value)
                candidates.extend(item.values())
            elif isinstance(item, list):
                if all(isinstance(entry, dict) for entry in item):
                    return item
                candidates.extend(item)
        return []

    def _extract_str(self, payload: dict[str, Any], keys: list[str]) -> str | None:
        for key in keys:
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return None

    def _to_plain(self, payload: Any) -> Any:
        if hasattr(payload, "model_dump"):
            return payload.model_dump()
        if hasattr(payload, "to_dict"):
            return payload.to_dict()
        return payload

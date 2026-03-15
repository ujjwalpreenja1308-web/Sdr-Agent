from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .composio_service import ComposioService


@dataclass
class HunterVerification:
    email: str
    status: Literal["valid", "risky", "invalid"]
    score: float | None
    note: str
    checked_at: str


class HunterVerificationService:
    def __init__(self, composio_service: ComposioService) -> None:
        self._composio_service = composio_service

    def verify_email(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
        email: str,
    ) -> HunterVerification:
        payload = self._composio_service.execute_tool(
            external_user_id=external_user_id,
            toolkit="hunter",
            connected_account_id=connected_account_id,
            tool_slug="HUNTER_EMAIL_VERIFIER",
            arguments={"email": email},
        )
        parsed = self._extract_verification_payload(payload)
        raw_status = str(parsed.get("status") or parsed.get("result") or "unknown").lower().strip()
        accept_all = parsed.get("accept_all")
        score = self._to_float(parsed.get("score"))
        checked_at = str(
            parsed.get("checked_at") or parsed.get("date") or "2026-03-15T16:45:00+05:30"
        )

        if raw_status == "valid":
            status: Literal["valid", "risky", "invalid"] = "valid"
        elif raw_status in {"accept_all", "webmail", "unknown"} or accept_all is True:
            status = "risky"
        else:
            status = "invalid"

        note = f"Hunter status: {raw_status or 'unknown'}"
        if accept_all is True:
            note += " (accept_all)"

        return HunterVerification(
            email=email,
            status=status,
            score=score,
            note=note,
            checked_at=checked_at,
        )

    def _extract_verification_payload(self, payload: Any) -> dict[str, Any]:
        current = self._to_plain(payload)
        if isinstance(current, dict) and isinstance(current.get("data"), dict):
            current = current["data"]
        if isinstance(current, dict) and isinstance(current.get("data"), dict):
            current = current["data"]
        if not isinstance(current, dict):
            raise RuntimeError("Hunter verification returned an unexpected payload.")
        return current

    def _to_plain(self, payload: Any) -> Any:
        if hasattr(payload, "model_dump"):
            return payload.model_dump()
        if hasattr(payload, "to_dict"):
            return payload.to_dict()
        return payload

    def _to_float(self, value: Any) -> float | None:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

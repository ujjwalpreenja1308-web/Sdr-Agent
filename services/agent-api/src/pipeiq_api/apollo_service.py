from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from .composio_service import ComposioService
from .models import OnboardingProfile


@dataclass
class ApolloProspect:
    full_name: str
    title: str
    company: str
    email: str
    signal_type: str
    signal_detail: str
    quality_score: int


@dataclass
class ApolloRunResult:
    mode: Literal["live", "mock"]
    sourced_count: int
    enriched_count: int
    prospects: list[ApolloProspect]
    note: str


class ApolloService:
    def __init__(self, composio_service: ComposioService) -> None:
        self._composio_service = composio_service

    def run_prospect_search(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
        onboarding: OnboardingProfile,
    ) -> ApolloRunResult:
        search_payload: dict[str, object] = {
            "page": 1,
            "per_page": 10,
            "person_titles": onboarding.titles[:5] or ["Founder", "CEO", "VP Sales"],
            "person_locations": onboarding.geos[:5] or ["United States"],
        }
        employee_ranges = self._employee_ranges(onboarding.company_sizes)
        if employee_ranges:
            search_payload["organization_num_employees_ranges"] = employee_ranges
        if onboarding.target_customer.strip():
            search_payload["q_keywords"] = onboarding.target_customer[:120]

        search_response = self._composio_service.execute_tool(
            external_user_id=external_user_id,
            toolkit="apollo",
            connected_account_id=connected_account_id,
            tool_slug="APOLLO_PEOPLE_SEARCH",
            arguments=search_payload,
        )
        raw_people = self._extract_people(search_response)

        prospects: list[ApolloProspect] = []
        for person in raw_people[:10]:
            enriched = self._enrich_person(
                external_user_id=external_user_id,
                connected_account_id=connected_account_id,
                person=person,
            )
            prospects.append(self._to_prospect(enriched or person, onboarding))

        return ApolloRunResult(
            mode="live",
            sourced_count=len(raw_people),
            enriched_count=len(prospects),
            prospects=prospects,
            note="Apollo people search and enrichment executed through Composio.",
        )

    def _enrich_person(
        self,
        *,
        external_user_id: str,
        connected_account_id: str,
        person: dict[str, Any],
    ) -> dict[str, Any] | None:
        enrich_args: dict[str, object] = {}
        person_id = person.get("id") or person.get("person_id")
        if person_id:
            enrich_args["id"] = str(person_id)
        else:
            first_name = str(person.get("first_name") or "").strip()
            last_name = str(person.get("last_name") or "").strip()
            if first_name:
                enrich_args["first_name"] = first_name
            if last_name:
                enrich_args["last_name"] = last_name
            organization = person.get("organization") or {}
            if isinstance(organization, dict) and organization.get("name"):
                enrich_args["organization_name"] = str(organization["name"])
            elif person.get("company"):
                enrich_args["organization_name"] = str(person["company"])
            if person.get("email"):
                enrich_args["email"] = str(person["email"])
        if not enrich_args:
            return None

        response = self._composio_service.execute_tool(
            external_user_id=external_user_id,
            toolkit="apollo",
            connected_account_id=connected_account_id,
            tool_slug="APOLLO_PEOPLE_ENRICHMENT",
            arguments=enrich_args,
        )
        return self._extract_person(response)

    def _extract_people(self, payload: Any) -> list[dict[str, Any]]:
        current = self._to_plain(payload)
        candidates = [current]
        while candidates:
            item = candidates.pop(0)
            if isinstance(item, dict):
                for key in ("people", "contacts", "results"):
                    value = item.get(key)
                    if isinstance(value, list):
                        return [entry for entry in value if isinstance(entry, dict)]
                candidates.extend(item.values())
            elif isinstance(item, list):
                candidates.extend(item)
        return []

    def _extract_person(self, payload: Any) -> dict[str, Any] | None:
        current = self._to_plain(payload)
        candidates = [current]
        while candidates:
            item = candidates.pop(0)
            if isinstance(item, dict):
                for key in ("person", "contact", "data"):
                    value = item.get(key)
                    if isinstance(value, dict) and (
                        value.get("id")
                        or value.get("email")
                        or value.get("first_name")
                        or value.get("name")
                    ):
                        return value
                if item.get("id") or item.get("email") or item.get("first_name") or item.get("name"):
                    return item
                candidates.extend(item.values())
            elif isinstance(item, list):
                candidates.extend(item)
        return None

    def _to_prospect(self, person: dict[str, Any], onboarding: OnboardingProfile) -> ApolloProspect:
        first_name = str(person.get("first_name") or "").strip()
        last_name = str(person.get("last_name") or "").strip()
        full_name = " ".join(part for part in [first_name, last_name] if part) or str(
            person.get("name") or "Unknown prospect"
        )
        organization = person.get("organization") or {}
        company = (
            str(organization.get("name") or "").strip() if isinstance(organization, dict) else ""
        ) or str(person.get("company") or "Unknown company")
        title = str(person.get("title") or "Unknown title")
        email = (
            str(person.get("email") or "").strip()
            or str(person.get("person", {}).get("email") or "").strip()
            or f"{first_name.lower() or 'prospect'}@example.com"
        )
        confidence = person.get("extrapolated_email_confidence") or person.get("email_confidence")
        score = 91
        try:
            if confidence is not None:
                score = max(60, min(99, int(float(confidence) * 100)))
        except (TypeError, ValueError):
            pass
        return ApolloProspect(
            full_name=full_name,
            title=title,
            company=company,
            email=email,
            signal_type="Apollo search match",
            signal_detail=onboarding.target_customer or "Matches the saved target profile.",
            quality_score=score,
        )

    def _employee_ranges(self, company_sizes: list[str]) -> list[str]:
        ranges: list[str] = []
        for size in company_sizes[:5]:
            match = re.search(r"(\d+)\s*[-,]\s*(\d+)", size)
            if match:
                ranges.append(f"{match.group(1)},{match.group(2)}")
        return ranges

    def _to_plain(self, payload: Any) -> Any:
        if hasattr(payload, "model_dump"):
            return payload.model_dump()
        if hasattr(payload, "to_dict"):
            return payload.to_dict()
        return payload

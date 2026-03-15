from __future__ import annotations

from dataclasses import dataclass

from composio import Composio
from composio_openai_agents import OpenAIAgentsProvider

from .config import Settings


@dataclass
class OAuthLaunch:
    toolkit: str
    session_id: str
    connection_id: str
    redirect_url: str | None


class ComposioService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def enabled(self) -> bool:
        return bool(self._settings.composio_api_key)

    def start_manual_oauth(
        self,
        *,
        external_user_id: str,
        toolkit: str,
        callback_url: str | None = None,
    ) -> OAuthLaunch:
        client = self._client()
        auth_configs = self._auth_configs_for(toolkit)
        session = client.create(
            user_id=external_user_id,
            toolkits={"enable": [toolkit]},
            manage_connections={"enable": False},
            auth_configs=auth_configs or None,
        )
        connection_request = session.authorize(
            toolkit=toolkit,
            callback_url=callback_url or self._settings.default_callback_url,
        )
        return OAuthLaunch(
            toolkit=toolkit,
            session_id=session.session_id,
            connection_id=connection_request.id,
            redirect_url=connection_request.redirect_url,
        )

    def fetch_connection(self, connection_id: str):
        client = self._client()
        return client.connected_accounts.get(connection_id)

    def build_agent_tools(self, *, external_user_id: str, connected_accounts: dict[str, str]):
        if not connected_accounts:
            return []

        client = self._client()
        session = client.create(
            user_id=external_user_id,
            toolkits={"enable": list(connected_accounts.keys())},
            manage_connections={"enable": False},
            connected_accounts=connected_accounts,
        )
        return session.tools()

    def execute_tool(
        self,
        *,
        external_user_id: str,
        toolkit: str,
        connected_account_id: str,
        tool_slug: str,
        arguments: dict[str, object],
    ):
        client = self._client()
        session = client.create(
            user_id=external_user_id,
            toolkits={"enable": [toolkit]},
            manage_connections={"enable": False},
            connected_accounts={toolkit: connected_account_id},
        )
        return session.execute(tool_slug, arguments=arguments)

    def _auth_configs_for(self, toolkit: str) -> dict[str, str]:
        auth_config_id = self._settings.composio_auth_configs.get(toolkit)
        return {toolkit: auth_config_id} if auth_config_id else {}

    def _client(self) -> Composio:
        if not self._settings.composio_api_key:
            raise RuntimeError(
                "COMPOSIO_API_KEY is not configured. Add it to services/agent-api/.env."
            )

        return Composio(
            provider=OpenAIAgentsProvider(),
            api_key=self._settings.composio_api_key,
        )

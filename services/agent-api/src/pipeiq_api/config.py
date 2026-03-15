from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = Field(default="development", alias="APP_ENV")
    frontend_url: str = Field(
        default="http://localhost:5173",
        alias="PIPEIQ_FRONTEND_URL",
    )
    default_callback_url: str = Field(
        default="http://localhost:5173",
        alias="PIPEIQ_DEFAULT_CALLBACK_URL",
    )
    allowed_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="PIPEIQ_ALLOWED_ORIGINS",
    )
    openai_model: str = Field(
        default="gpt-4.1-mini",
        alias="PIPEIQ_OPENAI_MODEL",
    )
    composio_api_key: str | None = Field(default=None, alias="COMPOSIO_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    apollo_api_key: str | None = Field(default=None, alias="PIPEIQ_APOLLO_API_KEY")
    apollo_base_url: str = Field(
        default="https://api.apollo.io",
        alias="PIPEIQ_APOLLO_BASE_URL",
    )
    instantly_api_key: str | None = Field(default=None, alias="PIPEIQ_INSTANTLY_API_KEY")
    instantly_base_url: str = Field(
        default="https://api.instantly.ai",
        alias="PIPEIQ_INSTANTLY_BASE_URL",
    )
    instantly_webhook_secret: str | None = Field(
        default=None,
        alias="PIPEIQ_INSTANTLY_WEBHOOK_SECRET",
    )
    public_api_url: str = Field(
        default="http://localhost:8000",
        alias="PIPEIQ_PUBLIC_API_URL",
    )
    gmail_auth_config_id: str | None = Field(
        default=None,
        alias="PIPEIQ_GMAIL_AUTH_CONFIG_ID",
    )
    googlecalendar_auth_config_id: str | None = Field(
        default=None,
        alias="PIPEIQ_GOOGLECALENDAR_AUTH_CONFIG_ID",
    )
    calendly_auth_config_id: str | None = Field(
        default=None,
        alias="PIPEIQ_CALENDLY_AUTH_CONFIG_ID",
    )
    hubspot_auth_config_id: str | None = Field(
        default=None,
        alias="PIPEIQ_HUBSPOT_AUTH_CONFIG_ID",
    )

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def composio_auth_configs(self) -> dict[str, str]:
        mappings = {
            "gmail": self.gmail_auth_config_id,
            "googlecalendar": self.googlecalendar_auth_config_id,
            "calendly": self.calendly_auth_config_id,
            "hubspot": self.hubspot_auth_config_id,
        }
        return {
            toolkit: auth_config_id
            for toolkit, auth_config_id in mappings.items()
            if auth_config_id
        }

    @property
    def oauth_toolkits(self) -> list[str]:
        return ["gmail", "googlecalendar", "calendly", "hubspot"]


@lru_cache
def get_settings() -> Settings:
    return Settings()

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Budget App configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")  # noqa: S104
    app_port: int = Field(default=8000, alias="APP_PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    # Comma-separated alternate keys; BUDGET_API_KEY is the primary.
    budget_api_key: str = Field(default="", alias="BUDGET_API_KEY")
    budget_api_keys: str = Field(default="", alias="BUDGET_API_KEYS")
    budget_rate_limit_per_minute: int = Field(
        default=60,
        alias="BUDGET_RATE_LIMIT_PER_MINUTE",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def clear_settings_cache() -> None:
    """Test helper — reload settings after env changes."""
    get_settings.cache_clear()

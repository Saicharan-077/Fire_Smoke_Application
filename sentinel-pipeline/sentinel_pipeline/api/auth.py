"""
API authentication.

The pipeline's API is the only way into detection data, so it must not be
open by default in a deployment. Behaviour:

  * ``PIPELINE_API_KEY`` set   -> every /v1 endpoint except /v1/health requires
                                  a matching ``X-API-Key`` header.
  * ``PIPELINE_API_KEY`` unset -> requests are allowed, a warning is logged at
                                  startup, and /v1/health reports
                                  ``"auth": "DISABLED"``.

Unset is deliberately permitted so local development and the test suite work
without ceremony -- but it is never silent. The state is visible on the health
endpoint, so a deployment running open cannot look identical to a secured one.
"""

from __future__ import annotations

import hmac
import logging
import os

from fastapi import Header, HTTPException

logger = logging.getLogger("sentinel.auth")


def configured_key() -> str | None:
    key = os.getenv("PIPELINE_API_KEY", "").strip()
    return key or None


def auth_mode() -> str:
    return "enabled" if configured_key() else "DISABLED"


def warn_if_open() -> None:
    if configured_key() is None:
        logger.warning(
            "PIPELINE_API_KEY is not set -- the /v1 API is UNAUTHENTICATED. "
            "Acceptable on localhost; set it before exposing this service."
        )


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """FastAPI dependency. No-op when no key is configured."""
    expected = configured_key()
    if expected is None:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(
            status_code=401,
            detail="missing or invalid X-API-Key",
            headers={"WWW-Authenticate": "ApiKey"},
        )

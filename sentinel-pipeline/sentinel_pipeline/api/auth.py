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

from fastapi import Header, HTTPException, Query, Request

# Imported for its side effect: loading `.env` into os.environ. Without this
# the key is only visible when something else has already imported config,
# which made auth silently report DISABLED depending on import order.
from .. import config as _config  # noqa: F401

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


#: Paths reachable without a key. `/v1/health` is deliberately open so an
#: uptime monitor or load balancer can probe the service, and so an operator can
#: see `"auth": "DISABLED"` without already holding a key. It exposes status
#: counters only -- no detection data, no evidence, no camera configuration.
OPEN_PATHS = frozenset({"/v1/health", "/docs", "/redoc", "/openapi.json"})


async def require_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None),
    api_key: str | None = Query(default=None),
) -> None:
    """FastAPI dependency. No-op when no key is configured.

    Applied at APP level. A route-level ``dependencies=[]`` does NOT override an
    app-level dependency in FastAPI -- both run -- so exemptions have to be
    handled here, by path.

    Accepts the key via the ``X-API-Key`` header (preferred) OR an
    ``api_key`` query parameter. The query param exists ONLY because the MJPEG
    stream and evidence images are loaded via plain ``<img>``/``<video>`` tags,
    which cannot set a custom header -- there is no fetch() in the middle to
    attach one to. Prefer the header everywhere a header is possible; this
    path is a deliberately narrow exception, not a general auth mechanism.
    """
    expected = configured_key()
    if expected is None:
        return
    if request.url.path in OPEN_PATHS:
        return
    supplied = x_api_key or api_key
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=401,
            detail="missing or invalid X-API-Key",
            headers={"WWW-Authenticate": "ApiKey"},
        )

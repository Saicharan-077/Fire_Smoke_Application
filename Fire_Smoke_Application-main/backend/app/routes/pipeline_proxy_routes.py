"""
Proxy for pipeline evidence images and MJPEG streams.

Why this exists
----------------
The pipeline's evidence images and MJPEG stream are consumed by plain
``<img>``/``<video>`` tags in the browser, which cannot attach a custom
``X-API-Key`` header. The pipeline's raw static API key must therefore never be
handed to the browser at all -- not in a header the tag can't send anyway, and
not in a URL query string either, which lands in browser history, any
intermediary proxy's access logs, and screenshots/screen-shares. That defeats
the entire point of having a key.

The fix: the DASHBOARD BACKEND holds the pipeline API key (server-side only,
from its own environment) and proxies these two request types through to the
pipeline, authenticating server-to-server. The browser talks only to the
dashboard's own authenticated session; it never sees the pipeline key in any
form.

This does NOT change who is authorized to view what -- these routes still sit
behind the dashboard's own ``get_current_user`` auth, exactly like every other
dashboard endpoint. It only changes where the pipeline credential lives.


Also provides a GENERIC proxy for every other pipeline endpoint (camera
registration, calibration, zones, detection, alerts, incidents, scheduler
status). The alternative -- letting the browser call the pipeline directly
with the raw key attached as a header -- puts the plaintext key in the shipped
JS bundle, extractable by anyone with dashboard access via dev tools or
view-source. That is a smaller-but-real version of the exact problem being
fixed for evidence/MJPEG, so it gets the same treatment: the pipeline key
lives ONLY in this backend process's environment, never in anything served to
a browser.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import Response, StreamingResponse

from .. import models
from .auth_routes import get_current_user, require_operator

logger = logging.getLogger("fireguard.pipeline_proxy")

router = APIRouter(prefix="/api/v1/pipeline-proxy", tags=["pipeline-proxy"])

_PIPELINE_BASE_URL = os.getenv("PIPELINE_BASE_URL", "http://localhost:8100")
_PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY", "")

# --- short-lived, scoped media tokens ---------------------------------------
#
# Evidence images and the MJPEG stream are consumed by <img>/<video> tags,
# which cannot send an Authorization header -- so the two GET routes below
# cannot require the dashboard's normal login-session auth either, the same
# constraint that broke the raw-pipeline-key approach one layer up.
#
# The fix here is NOT "make the route public" -- it's a token that is:
#   * minted only by an authenticated dashboard session (the mint endpoint
#     below DOES require a normal Bearer login, checked once, server-side)
#   * scoped to exactly one resource (one evidence filename, or one camera's
#     stream) -- it cannot be replayed against any other resource
#   * short-lived (2 minutes) -- long enough to cover minting a token and the
#     browser immediately using it to open the image/stream connection, far
#     too short to be a standing credential if it leaks into logs or a screen
#     recording
#
# This intentionally does NOT use a general-purpose signing library: it is a
# small, single-purpose HMAC construction, and pulling in a dependency for
# something this narrow would be the wrong trade.
_MEDIA_TOKEN_SECRET = os.getenv("DASHBOARD_MEDIA_TOKEN_SECRET", "")
_MEDIA_TOKEN_TTL_S = 120


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _mint_media_token(resource_type: str, resource_id: str) -> str:
    if not _MEDIA_TOKEN_SECRET:
        raise HTTPException(
            status_code=500,
            detail="DASHBOARD_MEDIA_TOKEN_SECRET is not configured on the server",
        )
    expiry = int(time.time()) + _MEDIA_TOKEN_TTL_S
    payload = f"{resource_type}:{resource_id}:{expiry}".encode()
    sig = hmac.new(_MEDIA_TOKEN_SECRET.encode(), payload, hashlib.sha256).digest()
    return f"{_b64u(payload)}.{_b64u(sig)}"


def _verify_media_token(token: str, resource_type: str, resource_id: str) -> bool:
    if not _MEDIA_TOKEN_SECRET:
        return False
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _b64u_decode(payload_b64)
        sig = _b64u_decode(sig_b64)
    except Exception:  # noqa: BLE001
        return False
    expected = hmac.new(_MEDIA_TOKEN_SECRET.encode(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        r_type, r_id, expiry_str = payload.decode().split(":", 2)
        expiry = int(expiry_str)
    except Exception:  # noqa: BLE001
        return False
    return r_type == resource_type and r_id == resource_id and expiry >= int(time.time())


@router.get("/media-token")
async def mint_media_token(
    resource_type: str = Query(..., pattern="^(evidence|stream)$"),
    resource_id: str = Query(...),
    current_user: models.User = Depends(get_current_user),
):
    """Mint a short-lived token for one evidence file or one camera's stream.

    THIS is where the actual access control lives: only a logged-in dashboard
    session can mint a token, and only for one named resource. The routes that
    accept the token do no session check of their own -- they can't, since the
    tag consuming them can't carry one -- so this endpoint is the real gate.
    """
    if resource_type == "evidence":
        resource_id = _validate_filename(resource_id)
    token = _mint_media_token(resource_type, resource_id)
    return {"token": token, "expires_in_s": _MEDIA_TOKEN_TTL_S}

# A bare filename only -- never a path. Evidence files live in one flat
# directory on the pipeline side; anything containing a separator is rejected
# before it ever reaches an outbound request.
_SAFE_NAME_CHARS = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
)


def _pipeline_headers() -> dict[str, str]:
    h = {}
    if _PIPELINE_API_KEY:
        h["X-API-Key"] = _PIPELINE_API_KEY
    return h


def _validate_filename(filename: str) -> str:
    if not filename or any(c not in _SAFE_NAME_CHARS for c in filename):
        raise HTTPException(status_code=400, detail="invalid evidence filename")
    return filename


@router.get("/evidence/{filename}")
async def proxy_evidence(
    filename: str = Path(...),
    token: str = Query(..., description="Short-lived token from /media-token"),
):
    """Fetch one evidence image from the pipeline, server-to-server.

    Gated by a resource-scoped media token (see above), not a login header --
    the <img> tag requesting this cannot send one. The pipeline API key never
    reaches the response either way.
    """
    name = _validate_filename(filename)
    if not _verify_media_token(token, "evidence", name):
        raise HTTPException(status_code=401, detail="invalid or expired media token")
    url = f"{_PIPELINE_BASE_URL}/v1/evidence/{name}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers=_pipeline_headers())
    except httpx.RequestError as exc:
        logger.error("[PipelineProxy] evidence fetch failed for %s: %s", name, exc)
        raise HTTPException(status_code=502, detail="pipeline unreachable") from exc

    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="evidence not found")
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"pipeline returned {resp.status_code}"
        )

    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "private, max-age=3600"},
    )


# --- generic proxy for the rest of the pipeline's /v1 surface ---------------

# Endpoints the pipeline itself treats as read-only vs. state-changing. Mirrors
# the distinction already used throughout the rest of this dashboard (GET
# needs only a login; POST/PUT/PATCH/DELETE needs operator-or-above), rather
# than inventing a new authorization model for pipeline data specifically.
_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Response headers that must not be blindly forwarded -- httpx/Starlette
# recompute framing themselves; forwarding the upstream's values causes
# mismatched Content-Length or double-encoding.
_STRIP_RESPONSE_HEADERS = {"content-length", "content-encoding", "transfer-encoding", "connection"}


@router.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def proxy_pipeline_api(
    path: str,
    request: Request,
    current_user: models.User = Depends(get_current_user),
):
    """Forward one request to the pipeline's `/v1/{path}`, key attached server-side.

    `path` never includes a leading `/v1/` -- the caller supplies just the
    pipeline-relative path (e.g. `cameras`, `detect/frame`,
    `cameras/{id}/calibrate/start`), and this always targets the pipeline's
    `/v1/` surface specifically, never anything else that might be listening
    on `PIPELINE_BASE_URL`.
    """
    if request.method in _MUTATING_METHODS:
        # Reuses the existing role-check function directly: it takes
        # `current_user` as a plain argument with a `Depends(...)` default,
        # so passing our own resolved user bypasses dependency injection
        # cleanly and just runs the role check (raises 403 on failure).
        require_operator(current_user=current_user)

    target = f"{_PIPELINE_BASE_URL}/v1/{path}"
    if request.url.query:
        target += f"?{request.url.query}"

    body = await request.body()
    headers = _pipeline_headers()
    content_type = request.headers.get("content-type")
    if content_type:
        headers["content-type"] = content_type

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.request(
                request.method, target, content=body, headers=headers
            )
    except httpx.RequestError as exc:
        logger.error("[PipelineProxy] %s %s failed: %s", request.method, target, exc)
        raise HTTPException(status_code=502, detail="pipeline unreachable") from exc

    passthrough_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in _STRIP_RESPONSE_HEADERS
    }
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=passthrough_headers,
        media_type=resp.headers.get("content-type"),
    )


@router.get("/stream/{camera_id}/mjpeg")
async def proxy_mjpeg(
    camera_id: str,
    token: str = Query(..., description="Short-lived token from /media-token"),
):
    """Stream the MJPEG feed for one camera through the dashboard backend.

    Gated by a resource-scoped media token, checked once at connect time --
    exactly like the evidence route, and for the same <video> tag reason. The
    token is not re-checked per frame; once the streamed response begins it
    persists on the open connection, same as any other long-lived stream.

    Streamed rather than buffered -- an MJPEG feed is unbounded, and buffering
    it would defeat the whole point of a live view.
    """
    if not _verify_media_token(token, "stream", camera_id):
        raise HTTPException(status_code=401, detail="invalid or expired media token")
    url = f"{_PIPELINE_BASE_URL}/v1/cameras/{camera_id}/stream/mjpeg"
    client = httpx.AsyncClient(timeout=None)
    try:
        req = client.build_request("GET", url, headers=_pipeline_headers())
        upstream = await client.send(req, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        logger.error("[PipelineProxy] mjpeg connect failed for %s: %s", camera_id, exc)
        raise HTTPException(status_code=502, detail="pipeline stream unreachable") from exc

    if upstream.status_code != 200:
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=upstream.status_code, detail="pipeline stream not running"
        )

    async def body():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body(),
        media_type=upstream.headers.get(
            "content-type", "multipart/x-mixed-replace; boundary=frame"
        ),
    )

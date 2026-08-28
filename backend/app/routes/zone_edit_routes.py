"""
Human corrections to pipeline zone/calibration data -- authorized, reasoned,
and logged.

Zone data (risk_weight, containment polygon, normal-behaviour envelope,
adjacency) drives the Context Engine's severity scoring directly -- getting
it wrong after a bad calibration run is a real operational problem, and
fixing it is NOT something any logged-in user should be able to do silently.

This module is deliberately separate from the generic pipeline-proxy
(`pipeline_proxy_routes.py`): the proxy forwards requests as-is with no
awareness of *why* something changed. Editing zone data needs three things
the proxy does not provide:
  1. Restricted to authorized accounts only (``require_operator`` -- the same
     tier already gating camera/alert/incident management elsewhere).
  2. A required, non-trivial reason for the change, so every correction is
     self-explaining in the audit trail, not just "risk_weight: 0.75 -> 0.9".
  3. A durable log entry (reusing the existing ``AuditLog`` table/mechanism,
     not a new one) recording who, when, what changed (before/after diff),
     and why -- readable back by any authorized user for the camera they
     just edited, not just admins via the full admin audit log.

The frontend enforces the actual "ask for approval" step as a review-then-
confirm UI flow (show the diff, require an explicit second click) before
this endpoint is ever called -- this endpoint's job is authorization +
durable logging, not re-implementing that UX gate server-side.
"""

from __future__ import annotations

import json
import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from .auth_routes import get_current_user, log_audit, require_operator

logger = logging.getLogger("fireguard.zone_edits")

router = APIRouter(prefix="/api/v1/zone-edits", tags=["zone-edits"])

_PIPELINE_BASE_URL = os.getenv("PIPELINE_BASE_URL", "http://localhost:8100")
_PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY", "")

MIN_REASON_LENGTH = 8

ZONE_EDIT_ACTION = "ZONE_EDIT"

# Fields worth diffing in the audit log -- top-level scalars/lists directly,
# envelope handled separately since it's a nested dict.
_DIFF_FIELDS = (
    "risk_weight", "polygon", "flammable_materials_nearby",
    "designated_activity_allowed", "adjacent_camera_ids",
)
_ENVELOPE_DIFF_FIELDS = (
    "min_area", "max_area", "mean_area", "std_area",
    "always_on", "area_sigma_tolerance",
)


class EnvelopeEditIn(BaseModel):
    min_area: int | None = None
    max_area: int | None = None
    mean_area: float | None = None
    std_area: float | None = None
    always_on: bool | None = None
    area_sigma_tolerance: float | None = Field(None, ge=0.1)


class ZoneEditRequest(BaseModel):
    reason: str = Field(..., min_length=MIN_REASON_LENGTH)
    risk_weight: float | None = Field(None, ge=0.0, le=1.0)
    polygon: list[list[int]] | None = None
    flammable_materials_nearby: bool | None = None
    designated_activity_allowed: list[str] | None = None
    adjacent_camera_ids: list[str] | None = None
    envelope: EnvelopeEditIn | None = None


def _pipeline_headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if _PIPELINE_API_KEY:
        h["X-API-Key"] = _PIPELINE_API_KEY
    return h


def _diff(before: dict, after: dict) -> list[dict]:
    changes = []
    for f in _DIFF_FIELDS:
        if before.get(f) != after.get(f):
            changes.append({"field": f, "before": before.get(f), "after": after.get(f)})
    env_before, env_after = before.get("envelope") or {}, after.get("envelope") or {}
    for f in _ENVELOPE_DIFF_FIELDS:
        if env_before.get(f) != env_after.get(f):
            changes.append({"field": f"envelope.{f}", "before": env_before.get(f), "after": env_after.get(f)})
    return changes


@router.post("/{camera_id}")
async def edit_zone(
    camera_id: str,
    payload: ZoneEditRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    """Apply a human correction to an already-approved pipeline zone.

    Calls the pipeline's PATCH .../zone directly (server-to-server, same
    pattern as the generic proxy) rather than going through
    pipeline-proxy_routes.py's forwarding route, because this needs the
    before/after payload that route returns to build the audit diff -- and
    needs to write the log entry ONLY on a successful pipeline write, never
    on a failed one.
    """
    body: dict = {}
    if payload.risk_weight is not None:
        body["risk_weight"] = payload.risk_weight
    if payload.polygon is not None:
        body["polygon"] = payload.polygon
    if payload.flammable_materials_nearby is not None:
        body["flammable_materials_nearby"] = payload.flammable_materials_nearby
    if payload.designated_activity_allowed is not None:
        body["designated_activity_allowed"] = payload.designated_activity_allowed
    if payload.adjacent_camera_ids is not None:
        body["adjacent_camera_ids"] = payload.adjacent_camera_ids
    if payload.envelope is not None:
        env = payload.envelope.model_dump(exclude_none=True)
        if env:
            body["envelope"] = env

    if not body:
        raise HTTPException(status_code=400, detail="no fields to change were supplied")

    url = f"{_PIPELINE_BASE_URL}/v1/cameras/{camera_id}/zone"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(url, json=body, headers=_pipeline_headers())
    except httpx.RequestError as exc:
        logger.error("[ZoneEdit] PATCH %s failed: %s", url, exc)
        raise HTTPException(status_code=502, detail="detection pipeline unreachable") from exc

    if resp.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail="no approved zone for this camera -- calibrate and approve a zone first",
        )
    if not resp.is_success:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"pipeline rejected the edit: {resp.text[:200]}",
        )

    result = resp.json()
    changes = _diff(result["before"], result["after"])

    log_audit(
        db, current_user, ZONE_EDIT_ACTION,
        json.dumps({
            "camera_id": camera_id,
            "zone_id": result["after"].get("zone_id"),
            "reason": payload.reason,
            "changes": changes,
        }),
    )
    logger.info(
        "ZONE_EDIT camera=%s zone=%s by=%s reason=%r fields=%s",
        camera_id, result["after"].get("zone_id"), current_user.username,
        payload.reason, [c["field"] for c in changes],
    )

    return {
        "before": result["before"],
        "after": result["after"],
        "changes": changes,
        "reason": payload.reason,
        "edited_by": current_user.username,
    }


@router.get("/{camera_id}")
def get_zone_edit_log(
    camera_id: str,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    """Edit history for one camera's zone -- any authorized (operator+) user
    can see it, not just admins via the full admin audit log. Filters the
    shared AuditLog table by action + camera_id parsed out of `details`,
    since AuditLog.details is a plain text/JSON blob, not structured columns
    -- acceptable at this table's real scale (edits are rare, deliberate
    actions, not a high-volume log)."""
    rows = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.action == ZONE_EDIT_ACTION)
        .order_by(models.AuditLog.timestamp.desc())
        .limit(500)
        .all()
    )
    out = []
    for r in rows:
        try:
            d = json.loads(r.details or "{}")
        except json.JSONDecodeError:
            continue
        if d.get("camera_id") != camera_id:
            continue
        out.append({
            "id": r.id, "username": r.username, "timestamp": r.timestamp.isoformat(),
            "zone_id": d.get("zone_id"), "reason": d.get("reason"), "changes": d.get("changes", []),
        })
        if len(out) >= limit:
            break
    return out

"""
Facility map: an uploaded site/floor plan image, camera placements on it
(position + facing direction + field-of-view cone), and the geometric
field-of-view overlap computed between every camera pair.

Why this exists (distinct from the pipeline's existing adjacency signals):
`sentinel-pipeline`'s Zone.adjacent_camera_ids is a human-declared fact, and
CalibrationManager._adjacency_candidates() is a behavioural correlation from
observed detection timing -- neither has any notion of WHERE cameras
physically are or HOW MUCH of the same physical space two cameras can
actually see. This module adds that third, geometric signal: given each
camera's position and FOV cone on a real site map, compute how much two
cones actually overlap. This was explicitly the missing "geometric seed"
noted in TODO_ACTION_ITEMS.md A2 ("needs a site map that does not exist
here") -- now that a real map can be uploaded, it can be computed for real.

This module NEVER writes to a pipeline zone's adjacent_camera_ids directly.
Overlap results are a SUGGESTION, surfaced for a human to review and, if they
agree, apply through zone_edit_routes.py -- the same authorized+reasoned+
logged path every other zone correction goes through. Treating a computed
percentage as ground truth without a human step would defeat the entire
point of that module.
"""

from __future__ import annotations

import logging
import math
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from .auth_routes import get_current_user, get_user_by_token, require_operator

logger = logging.getLogger("fireguard.facility_map")

router = APIRouter(prefix="/api/v1/facility-map", tags=["facility-map"])

FACILITY_MAP_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "facility_maps")
os.makedirs(FACILITY_MAP_DIR, exist_ok=True)

_ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
_MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB -- a floor plan image, not a photo archive


# ---------------------------------------------------------------------------
# Geometry: convex-sector construction + Sutherland-Hodgman intersection.
#
# A camera's field of view is modelled as a circular sector (a "pie slice"):
# apex at the camera's position, pointing at `facing_deg`, spanning `fov_deg`
# wide, extending `range_px`. Approximated as a polygon (apex + N arc points)
# so overlap can be computed with plain polygon clipping -- no geometry
# library dependency, consistent with this codebase's preference elsewhere
# (see CONTEXT_ENGINE_REPORT.md's calibration section: convex hull + MAD, no
# sklearn) for keeping deterministic geometry deterministic and dependency-
# free rather than reaching for a package.
#
# Angle convention: 0 degrees points "up" (toward -y, i.e. north on the
# image), increasing CLOCKWISE -- a compass bearing, which is what "facing
# direction" means to an operator placing a camera on a map. The frontend's
# SVG cone preview uses this exact same convention (dx=sin, dy=-cos) so what
# a human sets in the UI is exactly what this endpoint computes against.
# ---------------------------------------------------------------------------

_ARC_SEGMENTS = 24


def _sector_polygon(cx: float, cy: float, facing_deg: float, fov_deg: float, radius: float) -> list[tuple[float, float]]:
    if radius <= 0 or fov_deg <= 0:
        return []
    half = fov_deg / 2.0
    start = facing_deg - half
    step = fov_deg / _ARC_SEGMENTS
    pts = [(cx, cy)]
    for i in range(_ARC_SEGMENTS + 1):
        a = math.radians(start + step * i)
        pts.append((cx + radius * math.sin(a), cy - radius * math.cos(a)))
    return pts


def _polygon_area(pts: list[tuple[float, float]]) -> float:
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _clip_polygon(subject: list[tuple[float, float]], clip: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Sutherland-Hodgman: clip `subject` against convex polygon `clip`.
    Both our sector polygons are convex by construction, so this is exact,
    not an approximation of the intersection."""
    def inside(p, a, b):
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0

    def intersect(p1, p2, a, b):
        x1, y1 = p1; x2, y2 = p2; x3, y3 = a; x4, y4 = b
        d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(d) < 1e-9:
            return p2
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    output = subject
    cn = len(clip)
    for i in range(cn):
        a, b = clip[i], clip[(i + 1) % cn]
        input_list = output
        output = []
        if not input_list:
            break
        for j in range(len(input_list)):
            cur, prev = input_list[j], input_list[j - 1]
            cur_in, prev_in = inside(cur, a, b), inside(prev, a, b)
            if cur_in:
                if not prev_in:
                    output.append(intersect(prev, cur, a, b))
                output.append(cur)
            elif prev_in:
                output.append(intersect(prev, cur, a, b))
    return output


def _fov_overlap_pct(a: dict, b: dict, diagonal_px: float) -> tuple[float, float, float]:
    """Returns (overlap_area_px2, pct_of_a, pct_of_b)."""
    sector_a = _sector_polygon(a["x_px"], a["y_px"], a["facing_deg"], a["fov_deg"], a["range_pct"] / 100.0 * diagonal_px)
    sector_b = _sector_polygon(b["x_px"], b["y_px"], b["facing_deg"], b["fov_deg"], b["range_pct"] / 100.0 * diagonal_px)
    if len(sector_a) < 3 or len(sector_b) < 3:
        return 0.0, 0.0, 0.0
    inter = _clip_polygon(sector_a, sector_b)
    inter_area = _polygon_area(inter)
    area_a, area_b = _polygon_area(sector_a), _polygon_area(sector_b)
    pct_a = (inter_area / area_a * 100.0) if area_a > 0 else 0.0
    pct_b = (inter_area / area_b * 100.0) if area_b > 0 else 0.0
    return inter_area, pct_a, pct_b


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class PlacementIn(BaseModel):
    camera_id: str
    camera_name: str | None = None
    x_pct: float = Field(..., ge=0.0, le=100.0)
    y_pct: float = Field(..., ge=0.0, le=100.0)
    facing_deg: float = Field(0.0, ge=0.0, lt=360.0)
    fov_deg: float = Field(90.0, gt=0.0, le=360.0)
    range_pct: float = Field(25.0, gt=0.0, le=150.0)


def _placement_out(p: models.CameraPlacement) -> dict:
    return {
        "camera_id": p.camera_id, "camera_name": p.camera_name,
        "x_pct": p.x_pct, "y_pct": p.y_pct, "facing_deg": p.facing_deg,
        "fov_deg": p.fov_deg, "range_pct": p.range_pct,
        "updated_by": p.updated_by,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("")
async def upload_map(
    file: UploadFile = File(...),
    name: str = "Facility Map",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    """Replaces the active facility map. Existing camera placements are kept
    (they're keyed by camera_id, not by map_id-specific pixel positions the
    upload would invalidate) -- an operator may want to swap in an updated
    floor plan without re-placing every camera; if the new image's geometry
    differs meaningfully, placements can be individually adjusted afterward,
    same as any other correction."""
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"unsupported image type: {file.content_type}")
    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"image too large (max {_MAX_UPLOAD_BYTES // (1024*1024)}MB)")

    try:
        import cv2
        import numpy as np
        arr = np.frombuffer(data, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("could not decode image")
        height_px, width_px = img.shape[:2]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid image: {exc}") from exc

    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[file.content_type]
    filename = f"map_{uuid.uuid4().hex[:12]}.{ext}"
    with open(os.path.join(FACILITY_MAP_DIR, filename), "wb") as f:
        f.write(data)

    # Single active map: delete the previous row (and its image file) rather
    # than accumulating history -- see FacilityMap's docstring in models.py.
    old = db.query(models.FacilityMap).first()
    if old:
        old_path = os.path.join(FACILITY_MAP_DIR, old.filename)
        db.delete(old)
        db.commit()
        try:
            os.remove(old_path)
        except OSError:
            pass

    fm = models.FacilityMap(
        name=name, filename=filename, width_px=width_px, height_px=height_px,
        uploaded_by=current_user.username,
    )
    db.add(fm)
    db.commit()
    db.refresh(fm)
    logger.info("FACILITY_MAP_UPLOADED by=%s name=%r %dx%d", current_user.username, name, width_px, height_px)
    return {
        "id": fm.id, "name": fm.name, "width_px": fm.width_px, "height_px": fm.height_px,
        "uploaded_by": fm.uploaded_by, "uploaded_at": fm.uploaded_at.isoformat(),
    }


@router.get("")
def get_map(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Any logged-in user can VIEW the map + placements -- placing/editing is
    the sensitive action (gated below), viewing is not."""
    fm = db.query(models.FacilityMap).first()
    if fm is None:
        return {"map": None, "placements": []}
    placements = db.query(models.CameraPlacement).filter(models.CameraPlacement.map_id == fm.id).all()
    return {
        "map": {
            "id": fm.id, "name": fm.name, "width_px": fm.width_px, "height_px": fm.height_px,
            "uploaded_by": fm.uploaded_by, "uploaded_at": fm.uploaded_at.isoformat(),
        },
        "placements": [_placement_out(p) for p in placements],
    }


@router.get("/image")
def get_map_image(
    token: str = Query(..., description="Session token -- <img> tags can't send an Authorization header"),
    db: Session = Depends(get_db),
):
    user = get_user_by_token(token, db)
    if user is None:
        raise HTTPException(status_code=401, detail="invalid or expired session")
    fm = db.query(models.FacilityMap).first()
    if fm is None:
        raise HTTPException(status_code=404, detail="no facility map uploaded yet")
    path = os.path.join(FACILITY_MAP_DIR, fm.filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="map file missing on disk")
    return FileResponse(path)


@router.put("/cameras/{camera_id}")
def set_placement(
    camera_id: str,
    body: PlacementIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    """Place or move one camera on the active map. Authorized (operator+)
    only -- placement directly feeds the FOV-overlap adjacency suggestion
    below, so an unauthorized or careless placement could propose a wrong
    adjacency for a human to (hopefully) catch at the zone-edit approval
    step. Not reason-logged like zone_edit_routes.py -- placement itself
    changes no detection/alerting behaviour; only a human APPLYING a
    suggested adjacency into a zone does, and that already goes through the
    full reasoned+logged path."""
    fm = db.query(models.FacilityMap).first()
    if fm is None:
        raise HTTPException(status_code=400, detail="upload a facility map before placing cameras")
    if camera_id != body.camera_id:
        raise HTTPException(status_code=400, detail="camera_id in path and body must match")

    existing = (
        db.query(models.CameraPlacement)
        .filter(models.CameraPlacement.map_id == fm.id, models.CameraPlacement.camera_id == camera_id)
        .first()
    )
    if existing:
        existing.camera_name = body.camera_name
        existing.x_pct, existing.y_pct = body.x_pct, body.y_pct
        existing.facing_deg, existing.fov_deg, existing.range_pct = body.facing_deg, body.fov_deg, body.range_pct
        existing.updated_by = current_user.username
        row = existing
    else:
        row = models.CameraPlacement(
            map_id=fm.id, camera_id=camera_id, camera_name=body.camera_name,
            x_pct=body.x_pct, y_pct=body.y_pct, facing_deg=body.facing_deg,
            fov_deg=body.fov_deg, range_pct=body.range_pct, updated_by=current_user.username,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return _placement_out(row)


@router.delete("/cameras/{camera_id}")
def remove_placement(
    camera_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    fm = db.query(models.FacilityMap).first()
    if fm is None:
        return {"removed": False}
    deleted = (
        db.query(models.CameraPlacement)
        .filter(models.CameraPlacement.map_id == fm.id, models.CameraPlacement.camera_id == camera_id)
        .delete()
    )
    db.commit()
    return {"removed": bool(deleted)}


@router.get("/overlap")
def compute_overlap(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Every pairwise FOV overlap between placed cameras, computed fresh from
    current placements (cheap at the camera counts this system targets --
    O(n^2) pairs, each an O(1) polygon clip). A SUGGESTION only -- see this
    module's docstring. `pct_of_a`/`pct_of_b` are asymmetric on purpose: a
    wide-angle camera's small overlap with a narrow one is a very different
    fact from the narrow camera's perspective, and collapsing that into one
    symmetric number (e.g. Jaccard) would hide which camera is more exposed.
    """
    fm = db.query(models.FacilityMap).first()
    if fm is None:
        return {"pairs": []}
    placements = db.query(models.CameraPlacement).filter(models.CameraPlacement.map_id == fm.id).all()
    diagonal_px = math.hypot(fm.width_px, fm.height_px)

    cams = [{
        "camera_id": p.camera_id, "camera_name": p.camera_name,
        "x_px": p.x_pct / 100.0 * fm.width_px, "y_px": p.y_pct / 100.0 * fm.height_px,
        "facing_deg": p.facing_deg, "fov_deg": p.fov_deg, "range_pct": p.range_pct,
    } for p in placements]

    pairs = []
    for i in range(len(cams)):
        for j in range(i + 1, len(cams)):
            a, b = cams[i], cams[j]
            overlap_area, pct_a, pct_b = _fov_overlap_pct(a, b, diagonal_px)
            if overlap_area <= 0:
                continue
            pairs.append({
                "camera_a": a["camera_id"], "camera_a_name": a["camera_name"],
                "camera_b": b["camera_id"], "camera_b_name": b["camera_name"],
                "overlap_area_px2": round(overlap_area, 1),
                "pct_of_a_fov": round(pct_a, 1),
                "pct_of_b_fov": round(pct_b, 1),
            })
    pairs.sort(key=lambda r: max(r["pct_of_a_fov"], r["pct_of_b_fov"]), reverse=True)
    return {"pairs": pairs}

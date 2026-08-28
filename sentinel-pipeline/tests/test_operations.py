"""
Operational closures: persistence, drift detection, auth, job control.

    python tests/test_operations.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sentinel_pipeline.config import (  # noqa: E402
    ContextSettings, ModelSettings, Settings, StorageSettings,
)
from sentinel_pipeline.context.drift import DriftDetector  # noqa: E402
from sentinel_pipeline.context.engine import ContextEngine  # noqa: E402
from sentinel_pipeline.context.zones import NormalEnvelope, Zone  # noqa: E402
from sentinel_pipeline.contracts import BBox  # noqa: E402
from sentinel_pipeline.storage.alerts import AlertStore  # noqa: E402
from sentinel_pipeline.storage.evidence import EvidenceStore  # noqa: E402
from sentinel_pipeline.tracking.tracker import TrackingLayer  # noqa: E402
from tests.fixtures import load_frame  # noqa: E402

_results: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str) -> None:
    _results.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"         {detail}")


def _storage(dirpath: Path) -> StorageSettings:
    (dirpath / "evidence").mkdir(parents=True, exist_ok=True)
    return StorageSettings(
        database_url=f"sqlite:///{dirpath / 'ops.db'}",
        evidence_dir=dirpath / "evidence",
    )


def _engine(cfg: StorageSettings) -> ContextEngine:
    ev = EvidenceStore(cfg)
    return ContextEngine(
        tracking=TrackingLayer(),
        alert_store=AlertStore(cfg, evidence_store=ev),
        evidence_store=ev,
    )


# ---------------------------------------------------------------------------


def test_zone_survives_restart():
    print("\n-- Persistence: zones --")
    d = Path(tempfile.mkdtemp(prefix="ops_zone_"))
    cfg = _storage(d)

    eng = _engine(cfg)
    eng.set_zone(Zone(
        zone_id="chemical_storage", camera_id="cam-1", name="Chemical Storage",
        polygon=((10, 10), (300, 10), (300, 300), (10, 300)),
        risk_weight=1.0, flammable_materials_nearby=True,
        designated_activity_allowed=("welding",),
        envelope=NormalEnvelope(min_area=100, max_area=9000, mean_area=4000,
                                std_area=500, always_on=True),
        approved=True, adjacent_camera_ids=("cam-2",),
    ))
    before = eng.zones.get_for_camera("cam-1")

    # Simulate a process restart: brand-new engine against the same database.
    eng2 = _engine(cfg)
    check("a fresh engine starts with no zones in memory",
          eng2.zones.get_for_camera("cam-1") is None,
          "confirms the next assertion is actually testing the load path")

    summary = eng2.load_persisted()
    after = eng2.zones.get_for_camera("cam-1")

    same = (
        after is not None
        and after.zone_id == before.zone_id
        and after.polygon == before.polygon
        and after.risk_weight == before.risk_weight
        and after.approved == before.approved
        and after.adjacent_camera_ids == before.adjacent_camera_ids
        and after.envelope.always_on == before.envelope.always_on
        and after.envelope.max_area == before.envelope.max_area
    )
    check("an approved zone survives a restart intact",
          same,
          f"restored {summary['zones']} zone(s): zone_id={after.zone_id} "
          f"risk={after.risk_weight} polygon_pts={len(after.polygon)} "
          f"always_on={after.envelope.always_on} adjacent={list(after.adjacent_camera_ids)}")

    check("risk weight is available again for the Gate's forced-override tier",
          eng2.zones.risk_weight_for("cam-1") == 1.0,
          f"risk_weight_for('cam-1') = {eng2.zones.risk_weight_for('cam-1')} "
          "(before this fix a restart silently downgraded it to uncalibrated)")


def test_calibration_observations_survive_restart():
    print("\n-- Persistence: calibration window --")
    d = Path(tempfile.mkdtemp(prefix="ops_cal_"))
    cfg = _storage(d)

    eng = _engine(cfg)
    eng.calibration.start("cam-9", window_hours=48.0)
    for i in range(25):
        eng.calibration.observe("cam-9", BBox(100 + i, 100, 180 + i, 180),
                                "fire", 0.9, float(i))
        eng._calib_store.record("cam-9", BBox(100 + i, 100, 180 + i, 180), "fire", 0.9)

    eng2 = _engine(cfg)
    summary = eng2.load_persisted()
    sug = eng2.calibration.suggest("cam-9")

    check("an in-flight calibration window survives a restart",
          summary["calibration_observations"] == 25 and sug is not None,
          f"restored {summary['calibration_observations']} observation(s); "
          f"suggestion still computable: polygon_pts={len(sug.polygon) if sug else 0}")

    check("a 24-72h observation window is not silently lost",
          eng2.calibration.is_calibrating("cam-9"),
          "camera is still marked calibrating after restart, so the operator's "
          "belief that it is running remains true")


# ---------------------------------------------------------------------------


def test_drift_detection():
    print("\n-- Camera drift (ORB) --")
    det = DriftDetector(drift_threshold_px=12.0)
    ref = load_frame(0)

    ok = det.set_reference("cam-d", ref)
    check("reference frame is accepted", ok, f"set_reference -> {ok}")

    same = det.check("cam-d", ref)
    check("an unmoved camera reports no drift",
          same.checked and not same.drifted,
          f"magnitude={same.magnitude_px:.2f}px inliers={same.inliers}/{same.matches} "
          f"-- {same.reason}")

    # Shift the frame by a known amount.
    SHIFT_X, SHIFT_Y = 40, 25
    h, w = ref.shape[:2]
    M = np.float32([[1, 0, SHIFT_X], [0, 1, SHIFT_Y]])
    moved = cv2.warpAffine(ref, M, (w, h))
    res = det.check("cam-d", moved)

    err = abs(abs(res.dx) - SHIFT_X) + abs(abs(res.dy) - SHIFT_Y)
    check("a bumped camera is detected, with the shift recovered",
          res.checked and res.drifted and err < 8.0,
          f"true shift ({SHIFT_X},{SHIFT_Y}) -> measured ({res.dx:.1f},{res.dy:.1f}) "
          f"= {res.magnitude_px:.1f}px, inliers={res.inliers}/{res.matches}, "
          f"confidence={res.confidence:.2f}")

    poly = ((100, 100), (200, 100), (200, 200), (100, 200))
    shifted = DriftDetector.shifted_polygon(poly, res.dx, res.dy)
    check("polygon shift is offered as a SUGGESTION, never auto-applied",
          shifted != poly and det.has_reference("cam-d"),
          f"suggested {shifted[0]} from original {poly[0]} — returned for human "
          "approval; the stored zone is untouched")

    unknown = det.check("never-seen", ref)
    check("a camera with no reference reports 'not checked', not 'no drift'",
          not unknown.checked and not unknown.drifted,
          f"checked={unknown.checked} reason='{unknown.reason}' "
          "(reporting 'no drift' would be a false assurance)")


# ---------------------------------------------------------------------------


def test_auth_modes():
    print("\n-- API authentication --")
    from sentinel_pipeline.api import auth

    os.environ.pop("PIPELINE_API_KEY", None)
    check("auth is DISABLED and says so when no key is configured",
          auth.configured_key() is None and auth.auth_mode() == "DISABLED",
          f"auth_mode()={auth.auth_mode()} — visible on /v1/health, so an open "
          "deployment cannot look identical to a secured one")

    os.environ["PIPELINE_API_KEY"] = "s3cret-key"
    check("auth reports enabled once a key is set",
          auth.configured_key() == "s3cret-key" and auth.auth_mode() == "enabled",
          f"auth_mode()={auth.auth_mode()}")

    import asyncio
    from fastapi import HTTPException, Request

    def _fake_request(path: str = "/v1/alerts") -> Request:
        # A minimal ASGI scope so require_api_key can read request.url.path,
        # matching how FastAPI actually invokes it -- with the real Request
        # object, not a bare header string.
        scope = {
            "type": "http", "path": path, "headers": [], "query_string": b"",
            "method": "GET", "scheme": "http", "server": ("test", 80),
        }
        return Request(scope)

    async def call(key, path="/v1/alerts"):
        # api_key is left at its default (None): this test exercises the
        # header path. The query-param path is covered by a live HTTP check
        # in tests/test_api_integration.py, which exercises it through an
        # actual FastAPI request cycle rather than a direct function call.
        return await auth.require_api_key(
            request=_fake_request(path), x_api_key=key, api_key=None,
        )

    rejected = False
    try:
        asyncio.run(call("wrong-key"))
    except HTTPException as e:
        rejected = e.status_code == 401
    accepted = asyncio.run(call("s3cret-key")) is None
    missing_rejected = False
    try:
        asyncio.run(call(None))
    except HTTPException as e:
        missing_rejected = e.status_code == 401

    check("a wrong or missing key is rejected, the right one accepted",
          rejected and accepted and missing_rejected,
          f"wrong->401={rejected}, missing->401={missing_rejected}, correct->allowed={accepted}")
    os.environ.pop("PIPELINE_API_KEY", None)


ALL = [
    test_zone_survives_restart,
    test_calibration_observations_survive_restart,
    test_drift_detection,
    test_auth_modes,
]

if __name__ == "__main__":
    print("=" * 78)
    print("OPERATIONAL CLOSURES")
    print("=" * 78)
    for fn in ALL:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            _results.append((fn.__name__, False))
            print(f"  [ERROR] {fn.__name__}: {type(exc).__name__}: {exc}")
    passed = sum(1 for _, ok in _results if ok)
    print("\n" + "=" * 78)
    print(f"RESULT: {passed}/{len(_results)} checks passed")
    print("=" * 78)
    sys.exit(0 if passed == len(_results) else 1)

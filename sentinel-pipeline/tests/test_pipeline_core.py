"""
Core guarantees: evidence enforcement, tracking + crop history, Context Engine.

    python tests/test_pipeline_core.py
"""

from __future__ import annotations

import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sentinel_pipeline.config import ContextSettings, StorageSettings, TrackingSettings  # noqa: E402
from sentinel_pipeline.context.engine import ContextEngine  # noqa: E402
from sentinel_pipeline.context.severity import growth_rate  # noqa: E402
from sentinel_pipeline.context.zones import NormalEnvelope, Zone  # noqa: E402
from sentinel_pipeline.contracts import (  # noqa: E402
    BBox,
    ClassifierVerdict,
    ModelCandidate,
    RawClass,
    Severity,
    ThreatClass,
)
from sentinel_pipeline.storage.alerts import AlertStore, MissingEvidenceError  # noqa: E402
from sentinel_pipeline.storage.evidence import EvidenceStore  # noqa: E402
from sentinel_pipeline.tracking.tracker import TrackingLayer  # noqa: E402

_results: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str) -> None:
    _results.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"         {detail}")


def _tmp_storage() -> StorageSettings:
    d = Path(tempfile.mkdtemp(prefix="sentinel_test_"))
    (d / "evidence").mkdir(parents=True, exist_ok=True)
    return StorageSettings(
        database_url=f"sqlite:///{d / 'test.db'}",
        evidence_dir=d / "evidence",
        evidence_jpeg_quality=80,
    )


def _verdict(camera="cam1", track=1, cls=ThreatClass.FIRE, conf=0.9, bbox=None) -> ClassifierVerdict:
    return ClassifierVerdict(
        track_id=track, camera_id=camera, timestamp=datetime.now(timezone.utc),
        bbox=bbox or BBox(100, 100, 200, 200), threat_class=cls, confidence=conf,
        monotonic_ts=time.monotonic(),
    )


# ---------------------------------------------------------------------------
# 1. Evidence guarantee
# ---------------------------------------------------------------------------


def test_evidence_guarantee():
    print("\n-- Evidence guarantee (central enforcement) --")
    cfg = _tmp_storage()
    ev = EvidenceStore(cfg)
    store = AlertStore(cfg, evidence_store=ev)

    kw = dict(
        camera_id="cam1", threat_class=ThreatClass.FIRE, confidence=0.9,
        severity=Severity.HIGH, severity_score=0.7, source_type="test",
    )

    # a) omitting evidence entirely is a TypeError, not a silent None
    try:
        store.create(**kw)  # type: ignore[arg-type]
        ok_a, detail_a = False, "create() accepted a call with NO evidence argument"
    except TypeError as e:
        ok_a, detail_a = True, f"TypeError as required: {str(e)[:70]}"
    check("alert creation without an evidence argument is impossible", ok_a, detail_a)

    # b) empty string rejected
    try:
        store.create(evidence_ref="", **kw)
        ok_b, detail_b = False, "empty evidence_ref was accepted"
    except MissingEvidenceError as e:
        ok_b, detail_b = True, f"MissingEvidenceError: {str(e)[:70]}"
    check("empty evidence reference is refused", ok_b, detail_b)

    # c) reference to a non-existent file rejected
    try:
        store.create(evidence_ref="/evidence/does_not_exist.jpg", **kw)
        ok_c, detail_c = False, "dangling evidence_ref was accepted"
    except MissingEvidenceError as e:
        ok_c, detail_c = True, f"MissingEvidenceError: {str(e)[:70]}"
    check("evidence reference that doesn't resolve to a file is refused", ok_c, detail_c)

    # d) valid evidence succeeds
    frame = np.full((120, 160, 3), 120, dtype=np.uint8)
    ref = ev.save_frame(frame, camera_id="cam1", prefix="test")
    rec = store.create(evidence_ref=ref, **kw)
    check("alert with valid evidence is written",
          rec.id is not None and rec.evidence_ref == ref,
          f"alert id={rec.id[:8]}... evidence_ref={ref}")

    check("no alert in the store lacks evidence",
          store.count_missing_evidence() == 0,
          f"alerts_total={store.count()} missing_evidence={store.count_missing_evidence()}")


# ---------------------------------------------------------------------------
# 2. Tracking + crop history
# ---------------------------------------------------------------------------


def test_tracking_and_history():
    print("\n-- Shared tracking layer --")
    # History is DURATION-bounded (2s), not frame-count-bounded, so feed at a
    # realistic 30fps: 40 frames at 0.1s spacing would span 4s and be pruned to
    # the window, which is correct behaviour but not what this test is about.
    tracking = TrackingLayer(TrackingSettings(history_window_s=2.0, crop_padding_ratio=0.15))
    frame = np.random.default_rng(7).integers(0, 255, (480, 640, 3), dtype=np.uint8)

    # A single object drifting slowly across frames must keep ONE track id.
    ids = []
    base_ts = time.monotonic()
    for i in range(40):
        cand = ModelCandidate(
            camera_id="cam1", timestamp=datetime.now(timezone.utc),
            monotonic_ts=base_ts + i / 30.0,
            bbox=BBox(100 + i * 2, 100, 200 + i * 2, 200),
            class_raw=RawClass.FIRE, confidence_raw=0.7,
        )
        out = tracking.update("cam1", frame, [cand])
        if out:
            ids.append(out[0].track_id)

    unique = set(ids)
    check("one moving object keeps a single track_id across 40 frames",
          len(unique) == 1,
          f"track ids observed: {sorted(unique)} over {len(ids)} frames")

    last = tracking.update(
        "cam1", frame,
        [ModelCandidate(
            camera_id="cam1", timestamp=datetime.now(timezone.utc),
            monotonic_ts=base_ts + 40 / 30.0,
            bbox=BBox(180, 100, 280, 200), class_raw=RawClass.FIRE, confidence_raw=0.7,
        )],
    )[0]

    check("crop history reaches the depth the Flicker phase needs",
          len(last.history) >= 30 and last.history_span_s <= 2.0 + 1e-6,
          f"history length={len(last.history)} spanning {last.history_span_s:.2f}s "
          f"at {last.history_sample_rate_hz:.1f} Hz "
          "(Flicker needs 30-60 crops across roughly 1-2 seconds)")

    check("history entries are timestamped and carry both crop formats",
          all(
              h.crop_rgb.ndim == 3 and h.crop_grayscale.ndim == 2 and h.monotonic_ts > 0
              for h in last.history
          ),
          f"first entry: rgb{last.history[0].crop_rgb.shape} "
          f"gray{last.history[0].crop_grayscale.shape} ts={last.history[0].monotonic_ts:.2f}")

    check("crop is RGB and padded, with recoverable geometry",
          last.crop_padding_ratio == 0.15 and last.crop_origin[0] < last.bbox.x1,
          f"bbox.x1={last.bbox.x1} crop_origin={last.crop_origin} "
          f"padding={last.crop_padding_ratio} frame_size={last.frame_size}")

    check("track exposes age and duration for the Context Engine",
          last.track_age_frames > 30 and last.track_duration_s > 0,
          f"age_frames={last.track_age_frames} duration={last.track_duration_s:.2f}s")

    # Two separate objects must get distinct ids.
    tracking.reset_camera("cam2")
    cands = [
        ModelCandidate("cam2", datetime.now(timezone.utc), time.monotonic(),
                       BBox(10, 10, 60, 60), RawClass.FIRE, 0.8),
        ModelCandidate("cam2", datetime.now(timezone.utc), time.monotonic(),
                       BBox(400, 400, 460, 460), RawClass.FIRE, 0.8),
    ]
    out = tracking.update("cam2", frame, cands)
    check("two spatially separate objects get distinct track ids",
          len({o.track_id for o in out}) == 2,
          f"ids={sorted(o.track_id for o in out)}")


# ---------------------------------------------------------------------------
# 3. Context Engine
# ---------------------------------------------------------------------------


def _engine() -> ContextEngine:
    cfg = _tmp_storage()
    ev = EvidenceStore(cfg)
    return ContextEngine(
        tracking=TrackingLayer(),
        alert_store=AlertStore(cfg, evidence_store=ev),
        evidence_store=ev,
    )


def test_context_containment():
    print("\n-- Context Engine: containment --")
    eng = _engine()
    # A furnace zone: fire inside the mouth polygon is normal.
    eng.set_zone(Zone(
        zone_id="furnace", camera_id="cam1", name="Furnace",
        polygon=((80, 80), (320, 80), (320, 320), (80, 320)),
        risk_weight=0.5, designated_activity_allowed=("furnace",),
        envelope=NormalEnvelope(max_area=40000, mean_area=10000, std_area=2000, always_on=True),
        approved=True,
    ))

    inside = eng.assess(_verdict(bbox=BBox(120, 120, 220, 220)))
    outside = eng.assess(_verdict(bbox=BBox(400, 400, 500, 500)))

    check("fire INSIDE the containment boundary is not escalated",
          not inside.containment_breached and inside.severity in (Severity.INFO, Severity.LOW, Severity.MEDIUM),
          f"breached={inside.containment_breached} severity={inside.severity.value} "
          f"score={inside.score:.3f} containment_fraction={inside.reasoning['containment_fraction']}")

    check("fire OUTSIDE the containment boundary is escalated",
          outside.containment_breached and outside.score > inside.score,
          f"breached={outside.containment_breached} severity={outside.severity.value} "
          f"score={outside.score:.3f} (vs inside {inside.score:.3f})")

    # No zone at all -> always alert.
    eng2 = _engine()
    none_zone = eng2.assess(_verdict(camera="unknown-cam"))
    check("camera with NO zone defined always alerts (no silent blind spot)",
          none_zone.containment_breached and none_zone.should_alert,
          f"breached={none_zone.containment_breached} should_alert={none_zone.should_alert} "
          f"severity={none_zone.severity.value} "
          f"risk_defaulted={none_zone.reasoning['risk_weight_was_default']}")


def test_context_envelope_and_growth():
    print("\n-- Context Engine: normal envelope + growth --")
    eng = _engine()
    eng.set_zone(Zone(
        zone_id="flare", camera_id="cam1",
        polygon=((0, 0), (640, 0), (640, 480), (0, 480)),
        risk_weight=0.5, designated_activity_allowed=("flare",),
        envelope=NormalEnvelope(max_area=12000, mean_area=10000, std_area=500, always_on=True),
        approved=True,
    ))
    normal = eng.assess(_verdict(bbox=BBox(100, 100, 200, 200)))       # 10000
    oversize = eng.assess(_verdict(bbox=BBox(100, 100, 400, 400)))     # 90000

    check("detection within the normal envelope stays low",
          not normal.envelope_exceeded,
          f"area=10000 exceeded={normal.envelope_exceeded} score={normal.score:.3f} "
          f"({normal.reasoning['envelope_check']})")

    check("detection exceeding the normal envelope escalates",
          oversize.envelope_exceeded and oversize.score > normal.score,
          f"area=90000 exceeded={oversize.envelope_exceeded} score={oversize.score:.3f} "
          f"({oversize.reasoning['envelope_check']})")

    stable = growth_rate([(0.0, 10000), (1.0, 10000), (2.0, 10000)], 10.0)
    growing = growth_rate([(0.0, 10000), (1.0, 15000), (2.0, 22000)], 10.0)
    check("growth rate distinguishes a stable fire from a spreading one",
          abs(stable) < 1e-6 and growing > 0.5,
          f"stable={stable:.4f}/s  spreading={growing:.4f}/s")


def test_multi_camera_resolution():
    print("\n-- Context Engine: same fire vs different fires --")
    eng = _engine()
    # camA and camB overlap; camC is independent.
    eng.set_zone(Zone(zone_id="yard", camera_id="camA", risk_weight=0.5,
                      approved=True, adjacent_camera_ids=("camB",)))
    eng.set_zone(Zone(zone_id="yard", camera_id="camB", risk_weight=0.5,
                      approved=True, adjacent_camera_ids=("camA",)))
    eng.set_zone(Zone(zone_id="warehouse", camera_id="camC", risk_weight=0.5, approved=True))

    now = time.monotonic()
    inc1, new1 = eng.incidents.resolve(
        camera_id="camA", track_id=1, threat_class=ThreatClass.FIRE,
        severity=Severity.HIGH, score=0.7, monotonic_ts=now)
    inc2, new2 = eng.incidents.resolve(
        camera_id="camB", track_id=5, threat_class=ThreatClass.FIRE,
        severity=Severity.HIGH, score=0.7, monotonic_ts=now + 1.0)
    inc3, new3 = eng.incidents.resolve(
        camera_id="camC", track_id=9, threat_class=ThreatClass.FIRE,
        severity=Severity.HIGH, score=0.7, monotonic_ts=now + 1.5)

    check("adjacent cameras seeing one fire produce ONE incident",
          inc1.incident_id == inc2.incident_id and not new2 and inc2.is_multi_camera,
          f"camA -> {inc1.incident_id[:12]}, camB -> {inc2.incident_id[:12]}, "
          f"merged={inc1.incident_id == inc2.incident_id}, cameras={inc2.camera_ids}")

    check("non-overlapping camera produces a SEPARATE incident (never masked)",
          inc3.incident_id != inc1.incident_id and new3,
          f"camC -> {inc3.incident_id[:12]} (distinct from {inc1.incident_id[:12]}), "
          f"active incidents={len(eng.incidents.active())}")


def test_alerting_writes_evidence():
    print("\n-- Context Engine: alert path always attaches evidence --")
    eng = _engine()
    frame = np.full((480, 640, 3), 90, dtype=np.uint8)
    alerts = eng.process(
        [_verdict(conf=0.95), _verdict(track=2, cls=ThreatClass.BLACK_SMOKE, conf=0.8,
                                       bbox=BBox(300, 300, 400, 400))],
        frame=frame, source_type="test", trigger_reason="motion",
    )
    check("Context Engine writes alerts with evidence for every detection",
          len(alerts) == 2 and all(a["evidence_ref"] for a in alerts),
          f"{len(alerts)} alert(s); evidence refs: "
          f"{[a['evidence_ref'].rsplit('/',1)[-1][:28] for a in alerts]}")

    check("all alerts from one frame share a single evidence image",
          len({a["evidence_ref"] for a in alerts}) == 1,
          f"distinct evidence images for a 2-detection frame: "
          f"{len({a['evidence_ref'] for a in alerts})} (expected 1)")

    check("alerts carry the incident correlation",
          all(a["incident_id"] for a in alerts),
          f"incident ids: {[a['incident_id'][:12] for a in alerts]}")


def test_calibration_never_blinds():
    print("\n-- Calibration Mode --")
    eng = _engine()
    eng.calibration.start("cam1", window_hours=1.0)
    frame = np.full((480, 640, 3), 90, dtype=np.uint8)

    alerts = eng.process([_verdict(conf=0.95)], frame=frame, source_type="test")
    check("alerting continues DURING calibration (no blind spot)",
          len(alerts) == 1,
          f"{len(alerts)} alert(s) produced while camera is calibrating")

    for i in range(20):
        eng.calibration.observe(
            "cam1", BBox(200 + i, 200, 260 + i, 260), "fire", 0.9, time.monotonic() + i * 0.4
        )
    sug = eng.calibration.suggest("cam1")
    check("calibration suggests a polygon from observed detections",
          sug is not None and len(sug.polygon) >= 3,
          f"observations={sug.observation_count} polygon_points={len(sug.polygon)} "
          f"envelope_mean_area={sug.envelope.mean_area:.0f}")

    check("suggestion requires human approval and flags its own defaults",
          sug.as_dict()["requires_human_approval"] and any("risk_weight" in n for n in sug.notes),
          f"notes={list(sug.notes)}")

    # Boundary drift must flag, never auto-expand.
    eng.set_zone(Zone(zone_id="z", camera_id="camD", risk_weight=0.5,
                      polygon=((0, 0), (50, 0), (50, 50), (0, 50)), approved=True))
    before = eng.zones.get_for_camera("camD").polygon
    for _ in range(30):
        eng.assess(_verdict(camera="camD", bbox=BBox(300, 300, 350, 350)))
    after = eng.zones.get_for_camera("camD").polygon
    check("persistent out-of-bounds detections flag a human, never auto-expand the zone",
          before == after and "camD" in eng.drift_flagged_cameras(),
          f"polygon unchanged={before == after}, flagged_for_review={eng.drift_flagged_cameras()}")


ALL = [
    test_evidence_guarantee,
    test_tracking_and_history,
    test_context_containment,
    test_context_envelope_and_growth,
    test_multi_camera_resolution,
    test_alerting_writes_evidence,
    test_calibration_never_blinds,
]

if __name__ == "__main__":
    print("=" * 78)
    print("PIPELINE CORE GUARANTEES")
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

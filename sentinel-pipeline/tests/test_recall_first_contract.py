"""
G7 — the recall-first guarantee, and G1 — crop resolution.

Phase Reference, cross-cutting rules:
  "'Insufficient history/data' is always a distinct outcome from 'reject'
   across all phases, and defaults to escalation -- never silently drops a
   candidate lacking evidence."

Before this change the pipeline treated anything that wasn't a positive class
as a false positive and dropped it, so a phase reporting insufficient evidence
was indistinguishable from a confident rejection. These tests pin the new
behaviour.

    python tests/test_recall_first_contract.py
"""

from __future__ import annotations

import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sentinel_pipeline.classifier.base import Classifier  # noqa: E402
from sentinel_pipeline.config import (  # noqa: E402
    ModelSettings,
    Settings,
    StorageSettings,
    TrackingSettings,
)
from sentinel_pipeline.contracts import (  # noqa: E402
    BBox,
    ClassifierInput,
    ClassifierVerdict,
    ModelCandidate,
    RawClass,
    ThreatClass,
)
from sentinel_pipeline.pipeline import Pipeline  # noqa: E402
from sentinel_pipeline.tracking.tracker import TrackingLayer, extract_crops  # noqa: E402

_results: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str) -> None:
    _results.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"         {detail}")


class ScriptedClassifier(Classifier):
    """Returns whatever verdict the test tells it to."""

    name = "scripted"
    is_stub = True

    def __init__(self):
        self.mode = "confident_reject"

    def classify_batch(self, inputs: list[ClassifierInput]) -> list[ClassifierVerdict]:
        out = []
        for i in inputs:
            v = ClassifierVerdict(
                track_id=i.track_id, camera_id=i.camera_id, timestamp=i.timestamp,
                bbox=i.bbox, threat_class=ThreatClass.FIRE, confidence=0.8,
                monotonic_ts=i.monotonic_ts,
            )
            if self.mode == "confident_reject":
                v.threat_class = ThreatClass.FALSE_POSITIVE
                v.evidence_sufficient = True
            elif self.mode == "insufficient_with_class":
                v.threat_class = ThreatClass.FIRE
                v.evidence_sufficient = False
                v.advisory_phases = ("motion", "flicker")
            elif self.mode == "insufficient_as_fp":
                v.threat_class = ThreatClass.FALSE_POSITIVE
                v.evidence_sufficient = False
            elif self.mode == "omit":
                continue
            elif self.mode == "confident_pass":
                v.advisory_phases = ("flicker",)
            out.append(v)
        return out


def _settings() -> Settings:
    d = Path(tempfile.mkdtemp(prefix="g7_"))
    (d / "evidence").mkdir(parents=True, exist_ok=True)
    return Settings(
        storage=StorageSettings(
            database_url=f"sqlite:///{d / 'g7.db'}", evidence_dir=d / "evidence"
        ),
        model=ModelSettings(),
    )


def _fire_frame() -> np.ndarray:
    """A real fire image -- the actual model must produce candidates for these
    tests to exercise anything. A synthetic orange rectangle is not detected."""
    from tests.fixtures import load_frame

    return load_frame(0)


def main() -> int:
    print("=" * 78)
    print("G7 RECALL-FIRST GUARANTEE  +  G1 CROP RESOLUTION")
    print("=" * 78)

    clf = ScriptedClassifier()
    p = Pipeline(classifier=clf, settings=_settings())
    p.register_camera("cam-g7")
    frame = _fire_frame()

    print("\n-- Drop vs escalate --")

    clf.mode = "confident_reject"
    o = p.process_frame("cam-g7", frame, source_type="test", bypass_gate=True).as_dict()
    check("confident FALSE_POSITIVE (evidence sufficient) is dropped",
          o["rejected_false_positive"] > 0 and o["confirmed"] == 0 and not o["alerts"],
          f"rejected={o['rejected_false_positive']} confirmed={o['confirmed']} "
          f"escalated={o['escalated_unconfirmed']} alerts={len(o['alerts'])}")

    clf.mode = "insufficient_with_class"
    o = p.process_frame("cam-g7", frame, source_type="test", bypass_gate=True).as_dict()
    check("evidence_sufficient=False ESCALATES instead of dropping",
          o["escalated_unconfirmed"] > 0 and o["confirmed"] > 0,
          f"rejected={o['rejected_false_positive']} confirmed={o['confirmed']} "
          f"escalated={o['escalated_unconfirmed']} alerts={len(o['alerts'])}")

    if o["alerts"]:
        r = o["alerts"][0]["reasoning"]
        check("escalated candidate is marked unconfirmed on the alert record",
              r.get("escalated_unconfirmed") is True and r.get("evidence_sufficient") is False,
              f"evidence_sufficient={r.get('evidence_sufficient')} "
              f"escalated_unconfirmed={r.get('escalated_unconfirmed')} "
              f"advisory_phases={r.get('advisory_phases')}")
        check("log-only phases are recorded for audit, not used for control flow",
              r.get("advisory_phases") == ["motion", "flicker"],
              f"advisory_phases={r.get('advisory_phases')} "
              "(verdict still produced an alert, so they did not gate it)")

    clf.mode = "insufficient_as_fp"
    o = p.process_frame("cam-g7", frame, source_type="test", bypass_gate=True).as_dict()
    ok = o["escalated_unconfirmed"] > 0 and o["confirmed"] > 0
    sub = o["alerts"][0]["reasoning"].get("pipeline_class_substituted") if o["alerts"] else None
    check("FALSE_POSITIVE + insufficient evidence is still escalated, not dropped",
          ok,
          f"escalated={o['escalated_unconfirmed']} confirmed={o['confirmed']} "
          f"class_substituted={sub} -> class={o['alerts'][0]['class'] if o['alerts'] else None}")

    clf.mode = "omit"
    o = p.process_frame("cam-g7", frame, source_type="test", bypass_gate=True).as_dict()
    check("an omitted verdict remains an explicit rejection",
          o["rejected_false_positive"] > 0 and o["confirmed"] == 0,
          f"rejected={o['rejected_false_positive']} confirmed={o['confirmed']}")

    clf.mode = "confident_pass"
    o = p.process_frame("cam-g7", frame, source_type="test", bypass_gate=True).as_dict()
    check("a normal confident positive is unaffected by the change",
          o["confirmed"] > 0 and o["escalated_unconfirmed"] == 0 and len(o["alerts"]) > 0,
          f"confirmed={o['confirmed']} escalated={o['escalated_unconfirmed']} "
          f"alerts={len(o['alerts'])}")

    # ---------------------------------------------------------------
    print("\n-- G1: crop resolution --")

    tracking = TrackingLayer(TrackingSettings(max_crop_edge=256, crop_padding_ratio=0.15))
    big = np.random.default_rng(3).integers(0, 255, (1080, 1920, 3), dtype=np.uint8)
    cand = ModelCandidate(
        camera_id="c", timestamp=datetime.now(timezone.utc), monotonic_ts=1.0,
        bbox=BBox(400, 300, 1200, 900), class_raw=RawClass.FIRE, confidence_raw=0.8,
    )
    out = tracking.update("c", big, [cand])[0]

    native_w = out.cropped_frame_rgb.shape[1]
    check("current-frame crop is NATIVE resolution (Phase 1/2 pixel guards)",
          max(out.cropped_frame_rgb.shape[:2]) > 256 and out.crop_scale == 1.0,
          f"bbox is 800x600 -> crop {out.cropped_frame_rgb.shape[1]}x"
          f"{out.cropped_frame_rgb.shape[0]}, crop_scale={out.crop_scale} "
          "(was capped at 256 before this fix)")

    hist = out.history[-1]
    check("stored history crop is still capped, and reports its scale",
          max(hist.crop_rgb.shape[:2]) <= 256 and hist.crop_scale < 1.0,
          f"history crop {hist.crop_rgb.shape[1]}x{hist.crop_rgb.shape[0]}, "
          f"crop_scale={hist.crop_scale:.4f} -- Phase 3 must normalise "
          "displacement by this")

    check("per-side padding is reported for Phase 2's border strip",
          out.padding_applied == (120, 90, 120, 90),
          f"padding_applied (l,t,r,b) = {out.padding_applied} for a 15% pad "
          "on an 800x600 box away from any frame edge")

    # Candidate jammed against the frame edge -> asymmetric clipping.
    edge = ModelCandidate(
        camera_id="c2", timestamp=datetime.now(timezone.utc), monotonic_ts=1.0,
        bbox=BBox(0, 0, 200, 200), class_raw=RawClass.FIRE, confidence_raw=0.8,
    )
    eout = TrackingLayer(TrackingSettings()).update("c2", big, [edge])[0]
    check("padding clipping at a frame edge is visible, not silent",
          eout.padding_applied[0] == 0 and eout.padding_applied[2] > 0,
          f"box at (0,0) -> padding_applied = {eout.padding_applied}; "
          "left/top clipped to 0, right/bottom applied")

    check("history entries carry tracker match IoU (Phase 3 gate)",
          hist.match_iou is None,
          f"first snapshot match_iou={hist.match_iou} (None on first frame, "
          "populated on subsequent matches)")

    tracking.update("c", big, [ModelCandidate(
        camera_id="c", timestamp=datetime.now(timezone.utc), monotonic_ts=1.2,
        bbox=BBox(410, 310, 1210, 910), class_raw=RawClass.FIRE, confidence_raw=0.8)])
    tr = tracking.get_track("c", out.track_id)
    latest = tr.history[-1]
    check("second frame reports a real match IoU",
          latest.match_iou is not None and 0.9 < latest.match_iou < 1.0,
          f"match_iou={latest.match_iou:.4f} between consecutive bboxes")

    print("\n" + "=" * 78)
    passed = sum(1 for _, ok in _results if ok)
    print(f"RESULT: {passed}/{len(_results)} checks passed")
    print("=" * 78)
    return 0 if passed == len(_results) else 1


if __name__ == "__main__":
    sys.exit(main())

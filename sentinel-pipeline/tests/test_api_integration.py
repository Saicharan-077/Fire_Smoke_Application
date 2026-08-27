"""
End-to-end integration test against the running pipeline API.

Exercises the public surface only -- no imports of Gate/Model/Classifier/
Context internals -- which is itself the point: a dashboard integrator can do
everything below with nothing but HTTP.

    python tests/test_api_integration.py [base_url]
"""

from __future__ import annotations

import glob
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tests.fixtures import frame_paths  # noqa: E402

IMAGES = frame_paths()

_results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str) -> bool:
    _results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"         {detail}")
    return ok


def req(method: str, path: str, body: dict | None = None, raw: bytes | None = None,
        content_type: str | None = None):
    url = f"{BASE}{path}"
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif raw is not None:
        data = raw
        if content_type:
            headers["Content-Type"] = content_type
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            payload = resp.read()
            return resp.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, {"detail": payload.decode(errors="replace")[:200]}


def multipart(path: str, file_bytes: bytes, filename: str = "frame.jpg"):
    boundary = uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
        b"Content-Type: image/jpeg\r\n\r\n",
        file_bytes,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    return req("POST", path, raw=body, content_type=f"multipart/form-data; boundary={boundary}")


# ---------------------------------------------------------------------------


def main() -> int:
    print("=" * 78)
    print(f"PIPELINE API INTEGRATION TEST -> {BASE}")
    print("=" * 78)

    # 1. Health + contract
    st, health = req("GET", "/v1/health")
    check("GET /v1/health", st == 200 and health.get("status") == "ok",
          f"status={st} pipeline={health.get('status')} "
          f"contract={health.get('contract_version')} stub={health.get('classifier_is_stub')}")

    st, info = req("GET", "/v1/model/info")
    check("GET /v1/model/info returns LIVE model identity",
          st == 200 and info.get("architecture") == "yolo26s",
          f"architecture={info.get('architecture')} classes={info.get('classes')} "
          f"device={info.get('device')} conf_floor={info.get('conf_threshold')}")

    st, contract = req("GET", "/v1/contract")
    check("GET /v1/contract publishes the Classifier interface",
          st == 200 and "cropped_frame_rgb" in contract.get("classifier_input_fields", []),
          f"version={contract.get('contract_version')} "
          f"raw_classes={contract.get('raw_classes')}")

    # 2. Camera registration
    st, cam = req("POST", "/v1/cameras",
                  {"name": "Test Camera A", "location": "Bay 1"})
    cam_a = cam.get("camera_id") if cam else None
    check("POST /v1/cameras registers a camera", st == 201 and bool(cam_a),
          f"status={st} camera_id={cam_a}")

    st, cam2 = req("POST", "/v1/cameras", {"name": "Test Camera B", "location": "Bay 9"})
    cam_b = cam2.get("camera_id") if cam2 else None

    # 3. Detection through the API
    if not IMAGES:
        check("test images available", False, "no fire images found; cannot run detection")
        return 1

    st, res = multipart(f"/v1/detect/frame?camera_id={cam_a}&apply_gate=false",
                        open(IMAGES[0], "rb").read())
    ok = st == 200 and res.get("confirmed", 0) > 0
    check("POST /v1/detect/frame runs the full pipeline",
          ok,
          f"status={st} candidates={res.get('candidates')} tracked={res.get('tracked')} "
          f"confirmed={res.get('confirmed')} alerts={len(res.get('alerts', []))}")

    first_alert = (res.get("alerts") or [{}])[0]

    # 4. Evidence guarantee
    alerts_have_evidence = all(
        a.get("evidence_ref") for a in res.get("alerts", [])
    )
    check("every alert carries a non-null evidence reference",
          alerts_have_evidence and bool(res.get("alerts")),
          f"{len(res.get('alerts', []))} alert(s), all with evidence_ref: {alerts_have_evidence}")

    ev = first_alert.get("evidence_ref", "")
    if ev:
        fname = ev.rsplit("/", 1)[-1]
        try:
            with urllib.request.urlopen(f"{BASE}/v1/evidence/{fname}", timeout=30) as r:
                blob = r.read()
            check("evidence image is retrievable via the API",
                  r.status == 200 and len(blob) > 1000,
                  f"GET /v1/evidence/{fname} -> {r.status}, {len(blob)} bytes")
        except Exception as e:  # noqa: BLE001
            check("evidence image is retrievable via the API", False, str(e))

    # 5. Alerts endpoint
    st, alerts = req("GET", f"/v1/alerts?camera_id={cam_a}")
    check("GET /v1/alerts returns pipeline-owned alerts",
          st == 200 and len(alerts) > 0,
          f"status={st} count={len(alerts)} "
          f"first={alerts[0]['class'] if alerts else None}/"
          f"{alerts[0]['severity'] if alerts else None}")

    st, missing = req("GET", "/v1/health")
    check("health reports zero alerts missing evidence",
          missing.get("alerts_missing_evidence") == 0,
          f"alerts_total={missing.get('alerts_total')} "
          f"alerts_missing_evidence={missing.get('alerts_missing_evidence')}")

    # 6. Calibration lifecycle
    st, cal = req("POST", f"/v1/cameras/{cam_a}/calibrate/start", {"window_hours": 0.001})
    check("POST calibrate/start begins an observation window",
          st == 200,
          f"status={st} window={cal.get('window_hours')}h -- {cal.get('note','')[:60]}...")

    # Feed frames so calibration accumulates observations.
    for img in IMAGES[1:20]:
        multipart(f"/v1/detect/frame?camera_id={cam_a}&apply_gate=false",
                  open(img, "rb").read())

    st, sug = req("GET", f"/v1/cameras/{cam_a}/calibrate/suggestion")
    check("GET calibrate/suggestion proposes a containment polygon",
          st == 200 and sug.get("ready") and len(sug.get("polygon", [])) >= 3,
          f"status={st} ready={sug.get('ready')} observations={sug.get('observation_count')} "
          f"polygon_points={len(sug.get('polygon', []))} always_on={sug.get('always_on')} "
          f"requires_approval={sug.get('requires_human_approval')}")

    # 7. Zone approval propagates the risk tier into the Gate
    st, approved = req("POST", f"/v1/cameras/{cam_a}/zone", {
        "zone_id": "chemical_storage", "risk_weight": 1.0, "name": "Chemical Storage",
        "flammable_materials_nearby": True, "adjacent_camera_ids": [cam_b],
    })
    interval = approved.get("gate_forced_interval_s") if approved else None
    check("zone approval retunes the Gate's forced-override interval",
          st == 200 and approved.get("gate_risk_tier") == "high" and interval == 7.0,
          f"risk_weight=1.0 -> tier={approved.get('gate_risk_tier')} "
          f"forced_interval={interval}s (high-risk tier expects 7s)")

    # 8. Low-risk zone gets the long interval
    st, approved_b = req("POST", f"/v1/cameras/{cam_b}/zone", {
        "zone_id": "break_area", "risk_weight": 0.2, "name": "Break Area",
        "designated_activity_allowed": ["bonfire", "smoking_area"],
    })
    check("low-risk zone gets the long forced-override interval",
          approved_b.get("gate_risk_tier") == "low"
          and approved_b.get("gate_forced_interval_s") == 60.0,
          f"risk_weight=0.2 -> tier={approved_b.get('gate_risk_tier')} "
          f"forced_interval={approved_b.get('gate_forced_interval_s')}s")

    # 9. Incidents
    st, incidents = req("GET", "/v1/incidents?active_only=false")
    check("GET /v1/incidents correlates detections into incidents",
          st == 200 and len(incidents) > 0,
          f"status={st} incidents={len(incidents)} "
          f"multi_camera={sum(1 for i in incidents if i.get('is_multi_camera'))}")

    # 10. Gate telemetry is real, not fabricated
    st, gate = req("GET", f"/v1/cameras/{cam_a}/gate")
    check("GET gate telemetry returns real measured values",
          st == 200 and gate.get("risk_tier") == "high",
          f"state={gate.get('state')} frames_seen={gate.get('frames_seen')} "
          f"tier={gate.get('risk_tier')} interval={gate.get('forced_interval_s')}s "
          f"avg_process_ms={gate.get('avg_process_ms')}")

    st, _ = req("GET", "/v1/cameras/does-not-exist/gate")
    check("gate telemetry 404s for an unknown camera (never invents numbers)",
          st == 404, f"status={st} (a fabricated-metrics implementation would return 200)")

    print("=" * 78)
    passed = sum(1 for _, ok, _ in _results if ok)
    print(f"RESULT: {passed}/{len(_results)} checks passed")
    print("=" * 78)
    return 0 if passed == len(_results) else 1


if __name__ == "__main__":
    sys.exit(main())

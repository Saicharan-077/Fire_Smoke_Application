#!/usr/bin/env python3
"""
Stage-by-Stage Detection Pipeline Diagnostic Tool
Traces:
RAW FRAME -> PREPROCESSING -> RAW YOLO -> CLASS MAPPING -> CV VERIFICATION -> CONFIDENCE FUSION -> TEMPORAL TRACKING -> SUPPRESSION -> FINAL DETECTION
Logs input/output candidate counts, max confidences, and rejection reasons at each stage.
"""

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

import cv2
import torch
import numpy as np

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("backend"))
try:
    from backend.detection.detection_layer import DetectionLayer
    from backend.detection.config import DetectionConfig
except ModuleNotFoundError:
    from detection.detection_layer import DetectionLayer
    from detection.config import DetectionConfig

def compute_iou(b1, b2):
    ix1, iy1 = max(b1["x1"], b2["x1"]), max(b1["y1"], b2["y1"])
    ix2, iy2 = min(b1["x2"], b2["x2"]), min(b1["y2"], b2["y2"])
    if ix2 <= ix1 or iy2 <= iy1: return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    a1 = (b1["x2"] - b1["x1"]) * (b1["y2"] - b1["y1"])
    a2 = (b2["x2"] - b2["x1"]) * (b2["y2"] - b2["y1"])
    return inter / float(a1 + a2 - inter) if (a1 + a2 - inter) > 0 else 0.0

def trace_image_pipeline(img_path: str):
    print("=" * 60)
    print(f"PIPELINE TRACE: {os.path.basename(img_path)}")
    print("=" * 60)

    if not os.path.exists(img_path):
        print(f"[ERROR] File not found: {img_path}")
        return

    frame = cv2.imread(img_path)
    if frame is None:
        print(f"[ERROR] Could not decode image: {img_path}")
        return

    h, w = frame.shape[:2]
    print(f"Original Frame: {w}x{h}, dtype={frame.dtype}, min={frame.min()}, max={frame.max()}, mean={frame.mean():.1f}")

    layer = DetectionLayer()
    active_cfg = layer.config

    # STAGE 1: RAW YOLO
    model = layer.model
    results = model.predict(frame, conf=0.05, imgsz=640, verbose=False)
    
    stage1_dets = []
    for r in results:
        if r.boxes is not None:
            for b in r.boxes:
                cid = int(b.cls[0].item())
                conf = float(b.conf[0].item())
                xyxy = [round(float(c), 1) for c in b.xyxy[0].tolist()]
                stage1_dets.append({"cls_id": cid, "raw_name": model.names[cid], "conf": conf, "xyxy": xyxy})

    print(f"\nSTAGE 1 — RAW YOLO (conf >= 0.05)")
    for t in ["fire", "smoke", "sparks"]:
        matches = [d for d in stage1_dets if d["raw_name"] == t]
        mc = max((m["conf"] for m in matches), default=0.0)
        print(f"  {t.upper():<6}: count={len(matches)} max_conf={mc:.4f}")

    # STAGE 2: CLASS MAPPING
    stage2_dets = []
    for d in stage1_dets:
        mapped = layer._map_class(d["cls_id"], d["raw_name"])
        if mapped:
            stage2_dets.append({
                "detection_type": mapped,
                "confidence": d["conf"],
                "bbox": {"x1": int(d["xyxy"][0]), "y1": int(d["xyxy"][1]), "x2": int(d["xyxy"][2]), "y2": int(d["xyxy"][3])},
                "raw_class_name": d["raw_name"],
                "class_id": d["cls_id"]
            })
    print(f"\nSTAGE 2 — CLASS MAPPING")
    for t in ["fire", "smoke", "sparks"]:
        matches = [d for d in stage2_dets if d["detection_type"] == t]
        print(f"  {t.upper():<6}: count={len(matches)}")

    # Add CV sparks if any
    cv_cands = layer.detect_cv_candidates(frame)
    print(f"  [CV Spark Candidates Found]: {len(cv_cands)}")
    all_cands = list(stage2_dets)
    for cv_c in cv_cands:
        overlap = any(
            compute_iou(cv_c["bbox"], yd["bbox"]) > 0.05
            for yd in stage2_dets
        )
        if not overlap and cv_c["confidence"] >= 0.60:
            all_cands.append(cv_c)

    # STAGE 3: CV VERIFICATION
    hsv_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    stage3_accepted = []
    stage3_rejected = []

    for d in all_cands:
        bb = d["bbox"]
        cx1, cy1, cx2, cy2 = max(0, bb["x1"]), max(0, bb["y1"]), min(w, bb["x2"]), min(h, bb["y2"])
        if cx2 <= cx1 or cy2 <= cy1 or (cx2 - cx1) < 15 or (cy2 - cy1) < 15:
            stage3_rejected.append((d["detection_type"], d["confidence"], "box_too_small"))
            continue

        roi_bgr = frame[cy1:cy2, cx1:cx2]
        roi_hsv = hsv_frame[cy1:cy2, cx1:cx2]
        roi_gray = gray_frame[cy1:cy2, cx1:cx2]

        dt = d["detection_type"]
        if dt == "fire":
            valid, reason, scores = layer.verify_fire(roi_bgr, roi_hsv, active_cfg.fire)
        elif dt == "smoke":
            valid, reason, scores = layer.verify_smoke(roi_bgr, roi_hsv, roi_gray, active_cfg.smoke)
        elif dt in ("sparks", "spark"):
            valid, reason, scores = layer.verify_sparks(roi_bgr, roi_hsv)
        else:
            valid, reason, scores = True, "passed", {}

        if valid:
            d_copy = dict(d)
            d_copy["verification_scores"] = scores
            stage3_accepted.append(d_copy)
        else:
            stage3_rejected.append((dt, d["confidence"], reason, scores))

    print(f"\nSTAGE 3 — CV VERIFICATION")
    for t in ["fire", "smoke", "sparks"]:
        acc = [d for d in stage3_accepted if d["detection_type"] == t]
        rej = [r for r in stage3_rejected if r[0] == t]
        print(f"  {t.upper():<6}: candidates={len(acc)+len(rej)} accepted={len(acc)} rejected={len(rej)}")
        for r in rej:
            print(f"    [REJECTED] {t} conf={r[1]:.4f} reason: {r[2]}")

    # STAGE 4: CONFIDENCE FUSION
    stage4_dets = []
    for d in stage3_accepted:
        dt = d["detection_type"]
        raw_conf = d["confidence"]
        scores = d.get("verification_scores", {})
        
        if dt == "fire":
            flame_ratio = scores.get("flame_color_ratio", 0.0)
            brightness = scores.get("avg_brightness", 0.0) / 255.0
            sparks = scores.get("sparks_count", 0)
            flicker = scores.get("flicker_index", 0.0)
            color_score = min(1.0, flame_ratio / 0.08)
            fused = min(0.99, max(0.20, (0.55 * raw_conf) + (0.25 * color_score) + (0.12 * brightness) + (0.08 * flicker) + min(0.08, sparks * 0.02)))
            cv_ev = (0.25 * color_score) + (0.12 * brightness) + (0.08 * flicker)
        elif dt == "smoke":
            sat = scores.get("avg_saturation", 0.0) / 255.0
            chroma = scores.get("avg_chroma", 0.0) / 70.0
            entropy = scores.get("entropy", 0.0) / 6.5
            desat_score = max(0.0, 1.0 - sat)
            chroma_score = max(0.0, 1.0 - min(1.0, chroma))
            entropy_score = min(1.0, entropy)
            lap_score = min(1.0, max(0.2, 1.0 - abs(scores.get("laplacian_var", 150.0) - 150.0) / 1200.0))
            cv_ev = (0.35 * desat_score) + (0.25 * chroma_score) + (0.20 * entropy_score) + (0.20 * lap_score)
            fused = (0.60 * raw_conf) + (0.40 * cv_ev)
        else: # sparks
            max_b = scores.get("max_brightness", 160.0) / 255.0
            std_b = scores.get("std_brightness", 20.0) / 50.0
            cv_ev = (0.30 * min(1.0, max_b)) + (0.15 * min(1.0, std_b))
            fused = min(0.99, max(0.30, (0.55 * raw_conf) + cv_ev))

        d_fused = dict(d)
        d_fused["confidence"] = round(float(fused), 4)
        d_fused["raw_yolo_conf"] = raw_conf
        d_fused["cv_score"] = round(float(cv_ev), 4)
        stage4_dets.append(d_fused)

    print(f"\nSTAGE 4 — CONFIDENCE FUSION")
    for t in ["fire", "smoke", "sparks"]:
        matches = [d for d in stage4_dets if d["detection_type"] == t]
        if matches:
            for m in matches:
                print(f"  {t.upper():<6}: YOLO={m['raw_yolo_conf']:.4f} CV={m['cv_score']:.4f} FINAL={m['confidence']:.4f} bbox={m['bbox']}")
        else:
            print(f"  {t.upper():<6}: count=0")

    # STAGE 5: TEMPORAL (Single image: instant confirmation)
    print(f"\nSTAGE 5 — TEMPORAL PERSISTENCE")
    print(f"  (For static images, temporal persistence uses instant single-frame confirmation)")
    for t in ["fire", "smoke", "sparks"]:
        matches = [d for d in stage4_dets if d["detection_type"] == t]
        print(f"  {t.upper():<6}: candidate={len(matches)} persistent={len(matches)} confirmed={len(matches)}")

    # STAGE 6: ENCLOSURE & OVERLAP SUPPRESSION
    stage6_dets = []
    for d in sorted(stage4_dets, key=lambda x: (x["bbox"]["x2"] - x["bbox"]["x1"]) * (x["bbox"]["y2"] - x["bbox"]["y1"]), reverse=True):
        bb = d["bbox"]
        box_area = max(1, (bb["x2"] - bb["x1"]) * (bb["y2"] - bb["y1"]))
        is_enclosed = False
        for kept in stage6_dets:
            kbb = kept["bbox"]
            ix1, iy1 = max(bb["x1"], kbb["x1"]), max(bb["y1"], kbb["y1"])
            ix2, iy2 = min(bb["x2"], kbb["x2"]), min(bb["y2"], kbb["y2"])
            if ix2 > ix1 and iy2 > iy1:
                inter_area = (ix2 - ix1) * (iy2 - iy1)
                if d["detection_type"] in ("sparks", "spark") and kept["detection_type"] == "fire" and (inter_area / float(box_area)) > 0.15:
                    is_enclosed = True
                    print(f"  [SUPPRESSED] Sparks enclosed in fire box: inter_ratio={inter_area/box_area:.2f}")
                    break
                if d["detection_type"] == kept["detection_type"] and (inter_area / float(box_area)) > 0.35:
                    is_enclosed = True
                    print(f"  [SUPPRESSED] Redundant sub-box of same class {d['detection_type']}: inter_ratio={inter_area/box_area:.2f}")
                    break
        if not is_enclosed:
            stage6_dets.append(d)

    print(f"\nSTAGE 6 — SUPPRESSION (Enclosure & NMS)")
    print(f"  BEFORE: fire={len([d for d in stage4_dets if d['detection_type']=='fire'])} smoke={len([d for d in stage4_dets if d['detection_type']=='smoke'])} sparks={len([d for d in stage4_dets if d['detection_type']=='sparks'])}")
    print(f"  AFTER : fire={len([d for d in stage6_dets if d['detection_type']=='fire'])} smoke={len([d for d in stage6_dets if d['detection_type']=='smoke'])} sparks={len([d for d in stage6_dets if d['detection_type']=='sparks'])}")

    print(f"\nFINAL DETECTION OUTPUT")
    for d in stage6_dets:
        print(f"  • {d['detection_type'].upper():<6} conf={d['confidence']:.2%} bbox={d['bbox']}")

if __name__ == "__main__":
    img_path = r"C:\Users\Sai Charan\.gemini\antigravity-ide\brain\43936782-eb50-4d43-b724-c12d9fc0fd03\.user_uploaded\media_1790775538874.png"
    trace_image_pipeline(img_path)

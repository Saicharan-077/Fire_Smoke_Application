import os
import re

PLATFORM_DIR = r"C:\Users\Sai Charan\Desktop\innovision-platform"

def update_prometheus():
    prom_path = os.path.join(PLATFORM_DIR, "services", "uc2_fire_smoke", "src", "metrics", "prometheus.py")
    with open(prom_path, "r", encoding="utf-8") as f:
        content = f.read()

    if "SPARKS_DETECTIONS" not in content:
        target = 'SMOKE_DETECTIONS = Counter(\n    "uc2_smoke_detections_total",\n    "Total confirmed smoke detections",\n    ["camera_id", "zone_id"],\n    registry=REGISTRY,\n)'
        replacement = target + '\n\nSPARKS_DETECTIONS = Counter(\n    "uc2_sparks_detections_total",\n    "Total confirmed sparks detections",\n    ["camera_id", "zone_id"],\n    registry=REGISTRY,\n)'
        if target in content:
            content = content.replace(target, replacement)
            with open(prom_path, "w", encoding="utf-8") as f:
                f.write(content)
            print("[OK] Added SPARKS_DETECTIONS to prometheus.py")
        else:
            print("[WARN] Target not found in prometheus.py")
    else:
        print("[INFO] SPARKS_DETECTIONS already in prometheus.py")

def update_camera_worker():
    cw_path = os.path.join(PLATFORM_DIR, "services", "uc2_fire_smoke", "src", "workers", "camera_worker.py")
    with open(cw_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Update imports
    if "SPARKS_DETECTIONS," not in content:
        content = content.replace("SMOKE_DETECTIONS,", "SMOKE_DETECTIONS,\n    SPARKS_DETECTIONS,")
        print("[OK] Added SPARKS_DETECTIONS import in camera_worker.py")

    # 2. Update metric increment
    target_metric = 'elif det.detection_type == "smoke":\n                SMOKE_DETECTIONS.labels(camera_id=UUID(str(self.camera_id)) if not isinstance(self.camera_id, UUID) else self.camera_id, zone_id=det.zone.zone_id).inc()'
    replacement_metric = target_metric + '\n            elif det.detection_type in ("sparks", "spark"):\n                SPARKS_DETECTIONS.labels(camera_id=UUID(str(self.camera_id)) if not isinstance(self.camera_id, UUID) else self.camera_id, zone_id=det.zone.zone_id).inc()'
    if target_metric in content and 'SPARKS_DETECTIONS.labels' not in content:
        content = content.replace(target_metric, replacement_metric)
        print("[OK] Added SPARKS_DETECTIONS.inc() in camera_worker.py")

    # 3. Update metadata
    target_meta = '"smoke_confidence": det.yolo_confidence if det.detection_type == "smoke" else 0.0,'
    replacement_meta = target_meta + '\n                "sparks_confidence": det.yolo_confidence if det.detection_type in ("sparks", "spark") else 0.0,'
    if target_meta in content and '"sparks_confidence"' not in content:
        content = content.replace(target_meta, replacement_meta)
        print("[OK] Added sparks_confidence to metadata in camera_worker.py")

    with open(cw_path, "w", encoding="utf-8") as f:
        f.write(content)

def update_pipeline():
    pipe_path = os.path.join(PLATFORM_DIR, "services", "uc2_fire_smoke", "src", "detection", "pipeline.py")
    with open(pipe_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Add spark enclosure in smoke suppression
    if "spark_enclosed_in_smoke" not in content:
        target = '        confirmed: List[ConfirmedDetection] = []\n        suppressed: List[Dict[str, Any]] = []\n\n        active_detection_keys: List[str] = []\n\n        for candidate in raw_candidates:'
        replacement = '''        confirmed: List[ConfirmedDetection] = []
        suppressed: List[Dict[str, Any]] = []

        # Stage 1.5: Enclosure pre-filtering (sparks inside large smoke clouds suppressed)
        smoke_boxes = [c["bbox"] for c in raw_candidates if c["detection_type"] == "smoke"]
        valid_candidates = []
        for cand in raw_candidates:
            if cand["detection_type"] in ("sparks", "spark") and smoke_boxes:
                sb = cand["bbox"]
                sb_area = max(1, (sb["x2"] - sb["x1"]) * (sb["y2"] - sb["y1"]))
                inside_smoke = False
                for mb in smoke_boxes:
                    mb_area = max(1, (mb["x2"] - mb["x1"]) * (mb["y2"] - mb["y1"]))
                    if mb_area > sb_area * 1.8:
                        ix1 = max(sb["x1"], mb["x1"])
                        iy1 = max(sb["y1"], mb["y1"])
                        ix2 = min(sb["x2"], mb["x2"])
                        iy2 = min(sb["y2"], mb["y2"])
                        if ix2 > ix1 and iy2 > iy1:
                            inter_area = (ix2 - ix1) * (iy2 - iy1)
                            if (inter_area / float(sb_area)) > 0.25:
                                inside_smoke = True
                                break
                if inside_smoke:
                    suppressed.append({
                        "detection_type": cand["detection_type"],
                        "bbox": cand["bbox"],
                        "reason": "spark_enclosed_in_smoke",
                        "yolo_confidence": cand["confidence"],
                        "zone_id": "zone-default",
                        "frame_seq": frame_seq,
                    })
                    continue
            valid_candidates.append(cand)

        active_detection_keys: List[str] = []

        for candidate in valid_candidates:'''
        if target in content:
            content = content.replace(target, replacement)
            with open(pipe_path, "w", encoding="utf-8") as f:
                f.write(content)
            print("[OK] Added spark enclosure suppression to pipeline.py")
        else:
            print("[WARN] Target loop not found in pipeline.py")
    else:
        print("[INFO] spark_enclosed_in_smoke already in pipeline.py")

if __name__ == "__main__":
    update_prometheus()
    update_camera_worker()
    update_pipeline()
    print("Done applying updates.")

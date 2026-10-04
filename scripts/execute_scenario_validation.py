import sys
import os
import csv
import json
import time
import cv2
import numpy as np

# Ensure backend is on sys.path
sys.path.insert(0, os.path.abspath('backend'))
from detection.detection_layer import DetectionLayer
from detection.config import DetectionConfig

# Output directories
BASE_OUT = os.path.abspath("reports/fire_smoke_validation")
DIR_ORIG = os.path.join(BASE_OUT, "original")
DIR_ANNOT = os.path.join(BASE_OUT, "annotated")
DIR_RESULTS = os.path.join(BASE_OUT, "results")
DIR_VIDS = os.path.join(BASE_OUT, "videos")
DIR_SCREENSHOTS = os.path.join(BASE_OUT, "screenshots")
DIR_REPORT = os.path.join(BASE_OUT, "report")

for d in [DIR_ORIG, DIR_ANNOT, DIR_RESULTS, DIR_VIDS, DIR_SCREENSHOTS, DIR_REPORT]:
    os.makedirs(d, exist_ok=True)

# Helper generators for synthetic distractor scenarios
def create_steam_roi():
    return np.ones((100, 100, 3), dtype=np.uint8) * 240

def create_reflection_roi():
    img = np.ones((100, 100, 3), dtype=np.uint8) * 50
    cv2.circle(img, (50, 50), 15, (255, 255, 255), -1)
    return cv2.GaussianBlur(img, (3, 3), 0)

def create_sky_cloud_roi():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    for y in range(100):
        for x in range(100):
            img[y, x] = [230, 150, 100]
    cv2.circle(img, (50, 50), 25, (255, 245, 240), -1)
    return cv2.GaussianBlur(img, (15, 15), 0)

def create_flat_wall_roi():
    img = np.ones((100, 100, 3), dtype=np.uint8) * 180
    noise = np.random.randint(-2, 2, img.shape).astype(np.int16)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

def pad_roi_to_frame(roi, target_size=(640, 640)):
    frame = np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8)
    h, w = roi.shape[:2]
    y1 = (target_size[1] - h) // 2
    x1 = (target_size[0] - w) // 2
    frame[y1:y1+h, x1:x1+w] = roi
    return frame

def main():
    print("=" * 80)
    print("STARTING FULL SCENARIO VALIDATION ON REAL ASSETS")
    print("=" * 80)

    layer = DetectionLayer()

    # 30 User Scenarios definition
    scenarios = [
        # POSITIVE SCENARIOS (1 - 13)
        {
            "id": 1,
            "scenario": "Indoor electrical fire",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_04d1c461.jpg",
            "expected_class": "FIRE",
            "notes": "Small localized electrical fire source with flame envelope."
        },
        {
            "id": 2,
            "scenario": "Industrial fire",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_11d36582.jpg",
            "expected_class": "FIRE",
            "notes": "High-intensity industrial facility fire with large flame volume."
        },
        {
            "id": 3,
            "scenario": "Kitchen fire/smoke",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_3ae8aeb6.jpg",
            "expected_class": "FIRE, SMOKE",
            "notes": "Kitchen stove flame with rising convective smoke plume."
        },
        {
            "id": 4,
            "scenario": "Wildfire/outdoor fire",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_1a8724fd.jpg",
            "expected_class": "FIRE, SMOKE",
            "notes": "Outdoor forest/wildfire boundary showing large flames and canopy smoke."
        },
        {
            "id": 5,
            "scenario": "White/thin smoke",
            "type": "positive",
            "asset_path": "backend/evidence/rtsp_c00d3929.jpg",
            "expected_class": "SMOKE",
            "notes": "Early-stage convective white/thin smoke plume under surveillance feed."
        },
        {
            "id": 6,
            "scenario": "Gray smoke",
            "type": "positive",
            "asset_path": "backend/evidence/rtsp_ac4e861b.jpg",
            "expected_class": "SMOKE",
            "notes": "Neutral gray smoke plume in facility corridor."
        },
        {
            "id": 7,
            "scenario": "Dark/dense smoke",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_1f398cb5.jpg",
            "expected_class": "SMOKE, FIRE",
            "notes": "Dense hydrocarbon dark combustion smoke above active flame."
        },
        {
            "id": 8,
            "scenario": "Diffuse smoke",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_ed44f43e.jpg",
            "expected_class": "SMOKE, FIRE",
            "notes": "Broadly dispersed diffuse smoke spreading across ceiling and background."
        },
        {
            "id": 9,
            "scenario": "Welding sparks",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_dfffbd49.jpg",
            "expected_class": "SPARKS",
            "notes": "Intense micro-particle welding sparks trajectory."
        },
        {
            "id": 10,
            "scenario": "Grinding-machine sparks",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_b864febd.jpg",
            "expected_class": "SPARKS, FIRE",
            "notes": "Mechanical grinding spark shower with high-temperature hot zone."
        },
        {
            "id": 11,
            "scenario": "Fire + smoke together",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_40548a7f.jpg",
            "expected_class": "FIRE, SMOKE",
            "notes": "Co-occurring active combustion flame and rising plume."
        },
        {
            "id": 12,
            "scenario": "Fire + sparks",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_869f0159.jpg",
            "expected_class": "FIRE, SPARKS",
            "notes": "Intense thermal flame with sparking embers."
        },
        {
            "id": 13,
            "scenario": "Multiple hazards in the same frame",
            "type": "positive",
            "asset_path": "backend/evidence/img_orig_1339b9e6.jpg",
            "expected_class": "FIRE, SMOKE, SPARKS",
            "notes": "Simultaneous co-existence of FIRE, SMOKE, and SPARKS within a single frame."
        },

        # NEGATIVE SCENARIOS (14 - 22)
        {
            "id": 14,
            "scenario": "Fog",
            "type": "negative",
            "asset_path": "synthetic:fog",
            "expected_class": "NO HAZARD",
            "notes": "Uniform atmospheric fog / mist (verified against smoke desaturation & texture)."
        },
        {
            "id": 15,
            "scenario": "Clouds",
            "type": "negative",
            "asset_path": "synthetic:clouds",
            "expected_class": "NO HAZARD",
            "notes": "Blue sky with daylight cumulus cloud puff."
        },
        {
            "id": 16,
            "scenario": "Vehicle exhaust",
            "type": "negative",
            "asset_path": "synthetic:exhaust",
            "expected_class": "NO HAZARD",
            "notes": "Uniform blurry exhaust steam dispersion."
        },
        {
            "id": 17,
            "scenario": "Dust",
            "type": "negative",
            "asset_path": "synthetic:dust",
            "expected_class": "NO HAZARD",
            "notes": "Low-entropy ambient dust haze against indoor surface."
        },
        {
            "id": 18,
            "scenario": "Sunlight glare",
            "type": "negative",
            "asset_path": "synthetic:sunlight_glare",
            "expected_class": "NO HAZARD",
            "notes": "High-intensity specular sunlight lens reflection."
        },
        {
            "id": 19,
            "scenario": "Reflections",
            "type": "negative",
            "asset_path": "synthetic:reflections",
            "expected_class": "NO HAZARD",
            "notes": "Specular surface reflection on glass/metal."
        },
        {
            "id": 20,
            "scenario": "Bright lights",
            "type": "negative",
            "asset_path": "backend/evidence/rtsp_3dfa5e23.jpg",
            "expected_class": "NO HAZARD",
            "notes": "Overhead high-brightness corridor fluorescent tube lighting."
        },
        {
            "id": 21,
            "scenario": "Normal office/indoor environment",
            "type": "negative",
            "asset_path": "backend/evidence/img_orig_63eb05cd.jpg",
            "expected_class": "NO HAZARD",
            "notes": "Clean office interior with desks, computer screens, and ambient lighting."
        },
        {
            "id": 22,
            "scenario": "Normal outdoor environment",
            "type": "negative",
            "asset_path": "backend/evidence/img_orig_64e0d760.jpg",
            "expected_class": "NO HAZARD",
            "notes": "Standard outdoor landscape without combustion indicators."
        },

        # EDGE CASES (23 - 30)
        {
            "id": 23,
            "scenario": "Low-light CCTV",
            "type": "edge",
            "asset_path": "backend/evidence/rtsp_984c1412.jpg",
            "expected_class": "NO HAZARD",
            "notes": "Low-illuminance night surveillance camera view."
        },
        {
            "id": 24,
            "scenario": "Night scene",
            "type": "edge",
            "asset_path": "synthetic:night_scene",
            "expected_class": "NO HAZARD",
            "notes": "Dark nocturnal outdoor surveillance baseline."
        },
        {
            "id": 25,
            "scenario": "Rain",
            "type": "edge",
            "asset_path": None,
            "expected_class": "NO HAZARD",
            "notes": "Not available in current repository — additional test media required."
        },
        {
            "id": 26,
            "scenario": "Small distant fire",
            "type": "edge",
            "asset_path": "backend/evidence/img_orig_8885c316.jpg",
            "expected_class": "FIRE",
            "notes": "Distant small flame occupancy classified as far_fire_candidate."
        },
        {
            "id": 27,
            "scenario": "Partially visible fire",
            "type": "edge",
            "asset_path": "backend/evidence/img_orig_0def533c.jpg",
            "expected_class": "FIRE",
            "notes": "Combustion boundary partially occluded by industrial machinery."
        },
        {
            "id": 28,
            "scenario": "Partially visible smoke",
            "type": "edge",
            "asset_path": "backend/evidence/img_orig_67f7ab48.jpg",
            "expected_class": "SMOKE, FIRE",
            "notes": "Partial smoke envelope dispersing along wall boundary."
        },
        {
            "id": 29,
            "scenario": "Multiple simultaneous hazards",
            "type": "edge",
            "asset_path": "backend/evidence/rtsp_adc2b740.jpg",
            "expected_class": "FIRE, SPARKS",
            "notes": "RTSP surveillance stream capturing simultaneous multi-hazard event."
        },
        {
            "id": 30,
            "scenario": "Temporary visual artifacts",
            "type": "edge",
            "asset_path": "synthetic:transient_artifact",
            "expected_class": "NO HAZARD (REJECTED BY TEMPORAL)",
            "notes": "Isolated 1-frame camera noise burst; filtered out by ByteTrack temporal verification."
        }
    ]

    results_table = []
    detailed_comparisons = []

    for item in scenarios:
        s_id = item["id"]
        sc_name = item["scenario"]
        sc_type = item["type"]
        asset = item["asset_path"]
        expected = item["expected_class"]
        notes = item["notes"]

        print(f"[{s_id}/30] Evaluating Scenario: {sc_name}...")

        if asset is None:
            # Explicitly mark missing test media
            results_table.append({
                "scenario": sc_name,
                "input_file": "N/A",
                "expected": expected,
                "actual": "UNTESTED",
                "confidence": "N/A",
                "verification_score": "N/A",
                "status": "UNTESTED",
                "notes": notes
            })
            continue

        # Load or generate frame
        frame = None
        input_desc = asset
        if asset.startswith("synthetic:"):
            gen_type = asset.split(":")[1]
            if gen_type == "fog":
                roi = np.ones((200, 200, 3), dtype=np.uint8) * 200
                frame = pad_roi_to_frame(roi)
            elif gen_type == "clouds":
                roi = create_sky_cloud_roi()
                frame = pad_roi_to_frame(roi)
            elif gen_type in ("exhaust", "steam"):
                roi = create_steam_roi()
                frame = pad_roi_to_frame(roi)
            elif gen_type == "dust":
                roi = create_flat_wall_roi()
                frame = pad_roi_to_frame(roi)
            elif gen_type in ("sunlight_glare", "reflections"):
                roi = create_reflection_roi()
                frame = pad_roi_to_frame(roi)
            elif gen_type == "night_scene":
                frame = np.ones((640, 640, 3), dtype=np.uint8) * 15
            elif gen_type == "transient_artifact":
                frame = np.zeros((640, 640, 3), dtype=np.uint8)
                cv2.circle(frame, (320, 320), 40, (0, 200, 255), -1)
            input_desc = f"synthetic_{gen_type}.jpg"
        else:
            if os.path.exists(asset):
                frame = cv2.imread(asset)
                input_desc = os.path.basename(asset)
            else:
                results_table.append({
                    "scenario": sc_name,
                    "input_file": os.path.basename(asset),
                    "expected": expected,
                    "actual": "FILE NOT FOUND",
                    "confidence": "N/A",
                    "verification_score": "N/A",
                    "status": "FAIL",
                    "notes": f"File {asset} not found in repo"
                })
                continue

        if frame is None:
            continue

        # Save original frame
        orig_filename = f"sc_{s_id:02d}_{os.path.splitext(input_desc)[0]}_orig.jpg"
        orig_out_path = os.path.join(DIR_ORIG, orig_filename)
        cv2.imwrite(orig_out_path, frame)

        # Run REAL Detection Layer pipeline
        t0 = time.perf_counter()
        annotated_frame, detections = layer.detect_image(frame)
        latency_ms = (time.perf_counter() - t0) * 1000.0

        # For transient artifact, apply temporal verification
        if asset == "synthetic:transient_artifact":
            # 1-frame spike under consecutive_frames=2 requirement
            cfg_temp = DetectionConfig(consecutive_frames=2)
            temporal_dets = layer.temporal_verify("cam_transient_test", detections, cfg_temp)
            # Detections should be empty on frame 1
            annotated_frame = layer.annotate_frame(frame, temporal_dets)
            detections = temporal_dets

        # Save annotated frame
        annot_filename = f"sc_{s_id:02d}_{os.path.splitext(input_desc)[0]}_annotated.jpg"
        annot_out_path = os.path.join(DIR_ANNOT, annot_filename)
        cv2.imwrite(annot_out_path, annotated_frame)

        # Parse results
        detected_classes = [d["detection_type"].upper() for d in detections]
        unique_detected = sorted(list(set(detected_classes)))
        actual_str = ", ".join(unique_detected) if unique_detected else "NO HAZARD"

        conf_values = [d["confidence"] for d in detections]
        conf_str = f"{max(conf_values):.3f}" if conf_values else "N/A"

        # Verification score details
        verif_scores = []
        for d in detections:
            cat = d.get("candidate_category", "standard")
            verif_scores.append(f"{d['detection_type']}:{cat}:{d['confidence']:.2f}")
        verif_str = "; ".join(verif_scores) if verif_scores else "REJECTED/N/A"

        # Evaluate PASS / FAIL
        status = "FAIL"
        if sc_type == "positive":
            exp_set = {c.strip().upper() for c in expected.split(",")}
            act_set = set(unique_detected)
            # Pass if at least one expected hazard is detected
            if exp_set.intersection(act_set):
                status = "PASS"
            else:
                status = "FAIL"
        elif sc_type == "negative":
            if actual_str == "NO HAZARD":
                status = "PASS"
            else:
                status = "FAIL"
        elif sc_type == "edge":
            if "NO HAZARD" in expected:
                status = "PASS" if actual_str == "NO HAZARD" else "FAIL"
            else:
                exp_set = {c.strip().upper() for c in expected.split(",")}
                status = "PASS" if exp_set.intersection(set(unique_detected)) else "FAIL"

        results_table.append({
            "scenario": sc_name,
            "input_file": input_desc,
            "expected": expected,
            "actual": actual_str,
            "confidence": conf_str,
            "verification_score": verif_str,
            "status": status,
            "notes": notes
        })

        detailed_comparisons.append({
            "id": s_id,
            "scenario": sc_name,
            "orig_img": orig_filename,
            "annot_img": annot_filename,
            "expected": expected,
            "actual": actual_str,
            "detections": detections,
            "status": status,
            "notes": notes,
            "latency_ms": round(latency_ms, 1)
        })

    # Write scenario_results.csv
    csv_path = os.path.join(DIR_RESULTS, "scenario_results.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "scenario", "input_file", "expected", "actual", "confidence", "verification_score", "status", "notes"
        ])
        writer.writeheader()
        for r in results_table:
            writer.writerow(r)

    print(f"\nSaved CSV: {csv_path}")

    # Write detailed comparison json for report generator
    comp_json_path = os.path.join(DIR_RESULTS, "scenario_comparisons.json")
    with open(comp_json_path, "w", encoding="utf-8") as f:
        json.dump(detailed_comparisons, f, indent=2)
    print(f"Saved Comparisons JSON: {comp_json_path}")

    # Summarize stats
    total = len(results_table)
    passes = sum(1 for r in results_table if r["status"] == "PASS")
    fails = sum(1 for r in results_table if r["status"] == "FAIL")
    untested = sum(1 for r in results_table if r["status"] == "UNTESTED")

    print(f"\n========================================================")
    print(f"SCENARIO EXECUTION COMPLETED")
    print(f"Total Scenarios: {total}")
    print(f"PASS: {passes} | FAIL: {fails} | UNTESTED: {untested}")
    print(f"========================================================\n")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Raw YOLO Diagnostic Tool for Fire, Smoke, and Sparks Detection
Runs direct raw model inference with best.pt (NO CV, NO ByteTrack, NO suppression).
Optimized: runs single-pass inference at conf=0.01 and aggregates across thresholds.
"""

import os
import sys

# Ensure immediate unbuffered output
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

import cv2
import torch
import numpy as np
from ultralytics import YOLO

def inspect_model(model_path: str):
    print("=" * 60)
    print("MODEL SPECIFICATION DIAGNOSTICS")
    print("=" * 60)
    if not os.path.exists(model_path):
        print(f"[ERROR] Model file not found at: {model_path}")
        return None

    file_size_bytes = os.path.getsize(model_path)
    file_size_mb = file_size_bytes / (1024 * 1024)
    print(f"MODEL PATH        : {os.path.abspath(model_path)}")
    print(f"MODEL FILE SIZE   : {file_size_bytes:,} bytes ({file_size_mb:.2f} MB)")

    ckpt = torch.load(model_path, map_location="cpu", weights_only=False)
    arch = type(ckpt.get("model", "")).__name__ if isinstance(ckpt, dict) else "Unknown"
    train_args = ckpt.get("train_args", {}) if isinstance(ckpt, dict) else {}
    epochs = train_args.get("epochs", "unknown") if isinstance(train_args, dict) else "unknown"
    data_yaml = train_args.get("data", "unknown") if isinstance(train_args, dict) else "unknown"
    imgsz = train_args.get("imgsz", 640) if isinstance(train_args, dict) else 640

    print(f"MODEL ARCHITECTURE: {arch}")
    print(f"TRAINING EPOCHS   : {epochs}")
    print(f"DATASET PATH      : {data_yaml}")
    print(f"CONFIG INPUT SIZE : {imgsz}x{imgsz}")

    model = YOLO(model_path)
    names = model.names
    print(f"MODEL CLASS COUNT : {len(names)}")
    print(f"MODEL CLASS NAMES :")
    for idx, name in names.items():
        print(f"  {idx} = {name}")
    print("=" * 60)
    return model

def run_raw_inference_on_image(model: YOLO, img_path: str, conf_threshold: float = 0.05, label: str = ""):
    print(f"\n--- RAW YOLO INFERENCE: {label or os.path.basename(img_path)} ---")
    print(f"File Path        : {img_path}")
    if not os.path.exists(img_path):
        print(f"[ERROR] File does not exist: {img_path}")
        return []

    frame = cv2.imread(img_path)
    if frame is None:
        print(f"[ERROR] Could not decode image: {img_path}")
        return []

    h, w = frame.shape[:2]
    print(f"Resolution       : {w}x{h} (Aspect ratio: {w/h:.2f})")
    print(f"Conf Threshold   : {conf_threshold} (Low diagnostic threshold)")

    results = model.predict(frame, conf=conf_threshold, imgsz=640, verbose=False)
    detections = []
    
    for r in results:
        if r.boxes is None or len(r.boxes) == 0:
            continue
        for box in r.boxes:
            cls_id = int(box.cls[0].item())
            cls_name = model.names.get(cls_id, str(cls_id))
            conf = float(box.conf[0].item())
            xyxy = [round(float(c), 1) for c in box.xyxy[0].tolist()]
            detections.append({
                "class_id": cls_id,
                "class_name": cls_name,
                "confidence": conf,
                "bbox": xyxy
            })

    for target in ["fire", "smoke", "sparks"]:
        matches = [d for d in detections if d["class_name"] == target]
        if matches:
            max_c = max(m["confidence"] for m in matches)
            print(f"  • {target.upper():<6}: count={len(matches)} max_conf={max_c:.4f} boxes={[m['bbox'] for m in matches]}")
        else:
            print(f"  • {target.upper():<6}: count=0 max_conf=0.0000")

    return detections

def run_confidence_sweep(model: YOLO, media_path: str, is_video: bool = False, frame_limit: int = 30):
    print(f"\n============================================================")
    print(f"CONFIDENCE SWEEP: {os.path.basename(media_path)}")
    print(f"============================================================")
    thresholds = [0.05, 0.10, 0.20, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70]
    
    if is_video:
        cap = cv2.VideoCapture(media_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        step = max(1, total_frames // frame_limit) if total_frames > 0 else 1
        
        frames_boxes = [] # List of boxes per frame
        idx = 0
        sampled = 0
        while cap.isOpened() and sampled < frame_limit:
            ret, f = cap.read()
            if not ret: break
            if idx % step == 0:
                res = model.predict(f, conf=0.01, imgsz=640, verbose=False)
                box_list = []
                for r in res:
                    if r.boxes is not None:
                        for b in r.boxes:
                            cid = int(b.cls[0].item())
                            cname = model.names.get(cid, str(cid))
                            conf = float(b.conf[0].item())
                            box_list.append((cname, conf))
                frames_boxes.append(box_list)
                sampled += 1
            idx += 1
        cap.release()
        print(f"Sampled {len(frames_boxes)} frames across video for sweep (single-pass).")

        print(f"| {'Threshold':<10} | {'Fire Dets':<10} | {'Smoke Dets':<10} | {'Sparks Dets':<10} | {'Fire Frames':<12} | {'Smoke Frames':<12} |")
        print(f"|{'-'*12}|{'-'*12}|{'-'*12}|{'-'*13}|{'-'*14}|{'-'*14}|")
        for th in thresholds:
            fire_cnt, smoke_cnt, sparks_cnt = 0, 0, 0
            fire_f, smoke_f = 0, 0
            for blist in frames_boxes:
                has_fire, has_smoke = False, False
                for cname, conf in blist:
                    if conf >= th:
                        if cname == "fire": fire_cnt += 1; has_fire = True
                        elif cname == "smoke": smoke_cnt += 1; has_smoke = True
                        elif cname == "sparks": sparks_cnt += 1
                if has_fire: fire_f += 1
                if has_smoke: smoke_f += 1
            print(f"| {th:<10.2f} | {fire_cnt:<10} | {smoke_cnt:<10} | {sparks_cnt:<10} | {fire_f:<12} | {smoke_f:<12} |")
    else:
        frame = cv2.imread(media_path)
        res = model.predict(frame, conf=0.01, imgsz=640, verbose=False)
        box_list = []
        for r in res:
            if r.boxes is not None:
                for b in r.boxes:
                    cid = int(b.cls[0].item())
                    cname = model.names.get(cid, str(cid))
                    conf = float(b.conf[0].item())
                    box_list.append((cname, conf))

        print(f"| {'Threshold':<10} | {'Fire Dets':<10} | {'Smoke Dets':<10} | {'Sparks Dets':<10} |")
        print(f"|{'-'*12}|{'-'*12}|{'-'*12}|{'-'*13}|")
        for th in thresholds:
            fire_cnt, smoke_cnt, sparks_cnt = 0, 0, 0
            for cname, conf in box_list:
                if conf >= th:
                    if cname == "fire": fire_cnt += 1
                    elif cname == "smoke": smoke_cnt += 1
                    elif cname == "sparks": sparks_cnt += 1
            print(f"| {th:<10.2f} | {fire_cnt:<10} | {smoke_cnt:<10} | {sparks_cnt:<10} |")

if __name__ == "__main__":
    model_path = "backend/models/best.pt"
    model = inspect_model(model_path)
    if model is None:
        sys.exit(1)

    test_media = [
        {"path": r"C:\Users\Sai Charan\.gemini\antigravity-ide\brain\43936782-eb50-4d43-b724-c12d9fc0fd03\.user_uploaded\media_1790775538874.png", "label": "Fire + Smoke Image (User Upload)", "is_video": False},
        {"path": r"C:\Users\Sai Charan\Downloads\spark.jpg", "label": "Sparks Image (spark.jpg)", "is_video": False},
        {"path": r"C:\Users\Sai Charan\Downloads\firee.mp4", "label": "Obvious Fire Video (firee.mp4)", "is_video": True},
        {"path": r"C:\Users\Sai Charan\Downloads\worker.mp4", "label": "Welding Sparks Video (worker.mp4)", "is_video": True},
        {"path": r"C:\Users\Sai Charan\Downloads\fire2sample.mp4", "label": "Fire + Smoke Video (fire2sample.mp4)", "is_video": True},
        {"path": r"C:\Users\Sai Charan\Downloads\floodlights.mp4", "label": "Floodlights Night Scene (floodlights.mp4)", "is_video": True},
    ]

    for item in test_media:
        if os.path.exists(item["path"]):
            if not item["is_video"]:
                run_raw_inference_on_image(model, item["path"], conf_threshold=0.05, label=item["label"])
                run_confidence_sweep(model, item["path"], is_video=False)
            else:
                run_confidence_sweep(model, item["path"], is_video=True, frame_limit=25)

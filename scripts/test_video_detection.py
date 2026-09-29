#!/usr/bin/env python3
"""
SentinelOS Video Detection Validation & Benchmark CLI
Usage:
    python scripts/test_video_detection.py --video path/to/video.mp4 --mode Accuracy --output results/annotated.mp4
"""
import os
import sys
import argparse
import time
import json
import numpy as np

# Ensure backend modules can be imported
sys.path.insert(0, os.path.abspath("backend"))
sys.path.insert(0, os.path.abspath("."))

try:
    from backend.detection.detection_layer import DetectionLayer
    from backend.detection.config import DetectionConfig
except ModuleNotFoundError:
    from detection.detection_layer import DetectionLayer
    from detection.config import DetectionConfig


def run_video_test(video_path: str, mode: str = "Real-Time", conf: float = 0.18, output_path: str | None = None, verbose: bool = False):
    if not os.path.exists(video_path):
        print(f"[Error] Video file does not exist: {video_path}")
        sys.exit(1)

    print(f"\n========================================================")
    print(f"🔥 SentinelOS Video AI Detection Benchmark")
    print(f"========================================================")
    print(f"Video Path   : {os.path.abspath(video_path)}")
    print(f"Mode         : {mode}")
    print(f"Confidence   : {conf}")
    print(f"Output Path  : {output_path or 'None (Memory/Benchmark mode)'}")

    config = DetectionConfig(conf_threshold=conf, operating_mode=mode)
    layer = DetectionLayer(config=config)

    meta = layer.extract_video_metadata(video_path)
    print(f"\n[Video Metadata]")
    print(f"  • Resolution  : {meta.get('width', 0)}x{meta.get('height', 0)}")
    print(f"  • Source FPS  : {meta.get('fps', 0):.2f}")
    print(f"  • Total Frames: {meta.get('total_frames', 0)}")
    print(f"  • Duration    : {meta.get('duration_sec', 0):.2f}s")
    print(f"  • Codec       : {meta.get('codec', 'unknown')}")
    print(f"  • File Size   : {meta.get('file_size_mb', 0)} MB")
    print(f"  • AI Device   : {layer.device.upper()}")

    print(f"\n[Executing Frame-by-Frame Inference...]")
    t0 = time.perf_counter()

    stats = {
        "fire": 0,
        "smoke": 0,
        "sparks": 0,
    }
    events = []
    latencies = []

    last_pct = -1
    for update in layer.detect_video_stream(
        video_path,
        output_video_path=output_path,
        mode=mode,
    ):
        f_num = update["frame_number"]
        t_sec = update["timestamp_sec"]
        dets = update["detections"]
        pct = int(update["progress_pct"])
        lat = update.get("inference_time_ms", 0.0)
        if lat > 0:
            latencies.append(lat)

        for d in dets:
            dt = d["detection_type"]
            stats[dt] = stats.get(dt, 0) + 1

        if dets and update["run_inference"]:
            events.append({
                "frame": f_num,
                "time_sec": t_sec,
                "threats": [f"{d['detection_type']} ({d['confidence']:.0%})" for d in dets]
            })

        if pct % 10 == 0 and pct != last_pct:
            last_pct = pct
            print(f"  → Progress: {pct:3d}% | Frame: {f_num:4d}/{meta.get('total_frames', 0)} | Inf Latency: {lat:4.1f}ms | Active Dets: {len(dets)}")

        if verbose and dets:
            threat_str = ", ".join([f"{d['detection_type']}@{d['confidence']:.2f}" for d in dets])
            print(f"    [F#{f_num:04d} @ {t_sec:5.2f}s] {threat_str}")

    total_time = time.perf_counter() - t0
    total_frames = meta.get("total_frames", 1)
    overall_fps = total_frames / total_time if total_time > 0 else 0.0
    avg_latency = float(np.mean(latencies)) if latencies else 0.0

    print(f"\n========================================================")
    print(f"📊 Final Detection & Performance Report")
    print(f"========================================================")
    print(f"Total Processing Time : {total_time:.2f}s")
    print(f"Overall Processing FPS: {overall_fps:.1f} FPS (Source: {meta.get('fps', 0):.1f} FPS)")
    print(f"Avg Inference Latency : {avg_latency:.1f} ms")
    print(f"Detection Counts:")
    print(f"  • 🔥 Fire Frames    : {stats.get('fire', 0)}")
    print(f"  • 💨 Smoke Frames   : {stats.get('smoke', 0)}")
    print(f"  • ✨ Spark Frames   : {stats.get('sparks', 0)}")
    print(f"Total Detection Events: {len(events)}")
    if output_path and os.path.exists(output_path):
        print(f"Annotated Video Output: {os.path.abspath(output_path)} ({os.path.getsize(output_path)/(1024*1024):.2f} MB)")
    print(f"========================================================\n")

    return {
        "metadata": meta,
        "stats": stats,
        "performance": {
            "total_time_sec": round(total_time, 2),
            "processing_fps": round(overall_fps, 1),
            "avg_latency_ms": round(avg_latency, 1),
        },
        "event_count": len(events),
        "events": events[:30] # Top 30 events for summary
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SentinelOS Video Detection Validation CLI")
    parser.add_argument("--video", type=str, required=True, help="Path to input video file")
    parser.add_argument("--mode", type=str, default="Real-Time", choices=["Real-Time", "Accuracy", "Debug"], help="Inference mode")
    parser.add_argument("--conf", type=float, default=0.18, help="YOLO Confidence threshold")
    parser.add_argument("--output", type=str, default=None, help="Path to save annotated video output")
    parser.add_argument("--verbose", action="store_true", help="Print frame-by-frame detection events")
    args = parser.parse_args()

    run_video_test(
        video_path=args.video,
        mode=args.mode,
        conf=args.conf,
        output_path=args.output,
        verbose=args.verbose,
    )

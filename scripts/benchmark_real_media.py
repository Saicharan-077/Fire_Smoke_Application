import os
import sys
import time
import json
from collections import defaultdict
import cv2
import numpy as np

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.detection.detection_layer import DetectionLayer

def evaluate_video(layer: DetectionLayer, video_path: str, video_label: str, max_frames: int = 400):
    if not os.path.exists(video_path):
        return {"error": f"File not found: {video_path}"}

    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    print(f"\n========================================================")
    print(f"BENCHMARKING: {video_label}")
    print(f"File: {os.path.basename(video_path)} | {w}x{h} @ {fps:.1f} fps | {total_frames} total frames")
    print(f"========================================================")

    # Use generator to process frames
    counts = defaultdict(int)
    confs = defaultdict(list)
    tracks_seen = set()
    frame_latencies = []
    processed_count = 0
    start_time = time.perf_counter()

    # Run in Balanced / Accuracy mode
    stream_gen = layer.detect_video_stream(
        video_path=video_path,
        mode="Accuracy", # Evaluate thoroughly
        output_video_path=None
    )

    for item in stream_gen:
        processed_count += 1
        frame_idx = item.get("current_frame", processed_count)
        telemetry = item.get("telemetry", {})
        dets = item.get("detections", [])
        lat = telemetry.get("avg_latency_ms", 0.0)
        if lat > 0:
            frame_latencies.append(lat)

        for d in dets:
            dtype = d.get("detection_type", "unknown")
            conf = d.get("confidence", 0.0)
            tid = d.get("track_id")
            counts[dtype] += 1
            confs[dtype].append(conf)
            if tid is not None:
                tracks_seen.add(f"{dtype}_{tid}")

        if processed_count >= max_frames:
            break

    elapsed = time.perf_counter() - start_time
    avg_fps = (processed_count / elapsed) if elapsed > 0 else 0.0
    avg_lat = (sum(frame_latencies) / len(frame_latencies)) if frame_latencies else 0.0

    result = {
        "label": video_label,
        "video": os.path.basename(video_path),
        "dimensions": f"{w}x{h}",
        "fps": round(fps, 1),
        "total_frames": total_frames,
        "processed_frames": processed_count,
        "wall_time_sec": round(elapsed, 2),
        "avg_pipeline_fps": round(avg_fps, 2),
        "avg_latency_ms": round(avg_lat, 2),
        "detections": {
            "fire": {
                "count": counts["fire"],
                "max_conf": round(max(confs["fire"]), 3) if confs["fire"] else 0.0,
                "avg_conf": round(sum(confs["fire"]) / len(confs["fire"]), 3) if confs["fire"] else 0.0,
            },
            "smoke": {
                "count": counts["smoke"],
                "max_conf": round(max(confs["smoke"]), 3) if confs["smoke"] else 0.0,
                "avg_conf": round(sum(confs["smoke"]) / len(confs["smoke"]), 3) if confs["smoke"] else 0.0,
            },
            "sparks": {
                "count": counts["sparks"] + counts["spark"],
                "max_conf": round(max(confs["sparks"] + confs["spark"]), 3) if (confs["sparks"] or confs["spark"]) else 0.0,
                "avg_conf": round(sum(confs["sparks"] + confs["spark"]) / len(confs["sparks"] + confs["spark"]), 3) if (confs["sparks"] or confs["spark"]) else 0.0,
            }
        },
        "unique_active_tracks": len(tracks_seen)
    }

    print(json.dumps(result, indent=2))
    return result

def main():
    downloads_dir = r"C:\Users\Sai Charan\Downloads"
    videos_to_test = [
        ("Fire Only (Real Flame)", os.path.join(downloads_dir, "firee.mp4")),
        ("Smoke Only (User Regression - Forest Smoke Plume)", os.path.join(downloads_dir, "12773174_3840_2160_24fps.mp4")),
        ("Sparks Only (Welding Particles)", os.path.join(downloads_dir, "worker.mp4")),
        ("Fire + Smoke + Sparks (Multi-Hazard Complex)", os.path.join(downloads_dir, "fire2sample.mp4")),
        ("Hard Negative Distractor (Floodlights & Night Glare)", os.path.join(downloads_dir, "floodlights.mp4")),
    ]

    print("Initializing FireGuard AI Production Detection Layer...")
    layer = DetectionLayer()

    results = []
    for label, path in videos_to_test:
        if os.path.exists(path):
            res = evaluate_video(layer, path, label, max_frames=300)
            results.append(res)
        else:
            print(f"Skipping missing video: {path}")

    # Output markdown summary table
    print("\n" + "=" * 80)
    print("REAL VIDEO BENCHMARK SUMMARY TABLE")
    print("=" * 80)
    print("| Scenario / Media | Res | Frames | Fire (Max Conf) | Smoke (Max Conf) | Sparks (Max Conf) | Tracks | FPS |")
    print("|---|---|---|---|---|---|---|---|")
    for r in results:
        if "error" in r:
            continue
        f_info = f"{r['detections']['fire']['count']} ({r['detections']['fire']['max_conf']:.0%})" if r['detections']['fire']['count'] else "0"
        s_info = f"{r['detections']['smoke']['count']} ({r['detections']['smoke']['max_conf']:.0%})" if r['detections']['smoke']['count'] else "0"
        sp_info = f"{r['detections']['sparks']['count']} ({r['detections']['sparks']['max_conf']:.0%})" if r['detections']['sparks']['count'] else "0"
        print(f"| {r['label']} | {r['dimensions']} | {r['processed_frames']} | {f_info} | {s_info} | {sp_info} | {r['unique_active_tracks']} | {r['avg_pipeline_fps']} |")

    # Save to json file for reference
    with open("benchmark_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nBenchmark results saved to benchmark_results.json")

if __name__ == "__main__":
    main()

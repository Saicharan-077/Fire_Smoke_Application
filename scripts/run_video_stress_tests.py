import os
import sys
import time
import json

# Ensure workspace root and backend are in sys.path
sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("backend"))

from detection.config import DetectionConfig
from detection.detection_layer import DetectionLayer

def run_test_on_video(video_path: str, output_annotated_path: str = None):
    print("=" * 80)
    print(f"RUNNING VIDEO STRESS TEST ON: {video_path}")
    print("=" * 80)
    
    config = DetectionConfig(
        model_path=os.path.join("backend", "models", "best.pt"),
        conf_threshold=0.20,
        temporal_window_frames=25,
        min_event_persistence_frames=2,
        event_absence_grace_frames=8
    )
    
    pipeline = DetectionLayer(config=config)
    
    start_time = time.time()
    last_progress = 0
    final_result = None
    
    gen = pipeline.detect_video_stream(
        video_path=video_path,
        output_video_path=output_annotated_path,
        mode="Accuracy",
        db_settings={"frame_skip": 0}
    )
    
    for item in gen:
        if item.get("type") == "summary_ready" or item.get("event") == "video_analysis_completed":
            final_result = item
        elif "progress_pct" in item:
            pct = int(item.get("progress_pct", 0))
            if pct - last_progress >= 10:
                last_progress = pct
                print(f"  [Progress] {pct}% | Frame: {item.get('frame_number')}/{item.get('total_frames')} | Time: {item.get('timestamp_str')} | FPS: {item.get('fps', 0):.1f} | State: {item.get('composite_state')}", flush=True)

            
    elapsed = time.time() - start_time
    print(f"\nProcessing completed in {elapsed:.2f}s")
    
    if not final_result:
        print("ERROR: Pipeline did not return final complete payload!")
        return None
        
    print("\n--- VIDEO INFORMATION ---")
    vinfo = final_result.get("video_info", {})
    for k, v in vinfo.items():
        print(f"  {k}: {v}")
        
    print("\n--- DETECTION SUMMARY ---")
    dsum = final_result.get("detection_summary", {})
    for k, v in dsum.items():
        print(f"  {k}: {v}")
        
    print("\n--- EVENT STATISTICS ---")
    estats = final_result.get("event_statistics", {})
    for cls_name, stats in estats.items():
        print(f"  [{cls_name.upper()}]")
        for sk, sv in stats.items():
            print(f"    {sk}: {sv}")
            
    print("\n--- DYNAMIC TIMELINE SEGMENTS ---")
    timeline = final_result.get("timeline", [])
    for seg in timeline:
        hazard_tag = " [HAZARD]" if seg.get("is_hazard") else ""
        print(f"  {seg.get('start_time')} - {seg.get('end_time')} : {seg.get('state')}{hazard_tag} (conf={seg.get('peak_confidence', 0):.2f})")
        
    return final_result

if __name__ == "__main__":
    v1 = "test_video_1.mp4"
    v2 = "test_video_2.mp4"
    
    res1 = run_test_on_video(v1, "reports/fire_smoke_validation/annotated/annotated_test_video_1.mp4")
    res2 = run_test_on_video(v2, "reports/fire_smoke_validation/annotated/annotated_test_video_2.mp4")
    
    with open("video_stress_test_results.json", "w") as f:
        json.dump({"video_1": res1, "video_2": res2}, f, indent=2)
    print("\nSaved full test results to video_stress_test_results.json")

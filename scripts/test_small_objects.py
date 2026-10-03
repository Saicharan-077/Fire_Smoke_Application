import cv2
import sys
import os

PLATFORM_DIR = r"C:\Users\Sai Charan\Desktop\innovision-platform"
sys.path.insert(0, PLATFORM_DIR)
sys.path.insert(0, os.path.join(PLATFORM_DIR, "services", "uc2_fire_smoke"))

from services.uc2_fire_smoke.src.detection.pipeline import DetectionPipeline

def main():
    p = DetectionPipeline()
    test_cases = [
        ("sample_fire.jpg", os.path.join(PLATFORM_DIR, "test_data", "images", "sample_fire.jpg")),
        ("sample_smoke.jpg", os.path.join(PLATFORM_DIR, "test_data", "images", "sample_smoke.jpg")),
        ("sample_sparks.jpg", os.path.join(PLATFORM_DIR, "test_data", "images", "sample_sparks.jpg")),
    ]

    for name, path in test_cases:
        img = cv2.imread(path)
        if img is None:
            print(f"Skipping {name}: not found")
            continue
        h, w = img.shape[:2]
        total_area = h * w
        res = p.process_frame("00000000-0000-0000-0000-000000000002", 1, img, single_frame=True)
        print(f"\n=== {name} ({w}x{h} = {total_area} px) ===")
        for d in res.confirmed_detections:
            bx = d.bbox
            bw = bx["x2"] - bx["x1"]
            bh = bx["y2"] - bx["y1"]
            area = bw * bh
            pct = (area / total_area) * 100.0
            print(f"  {d.detection_type.upper()}: bbox=[{bx['x1']},{bx['y1']},{bx['x2']},{bx['y2']}], size={bw}x{bh} ({area} px, {pct:.2f}% of frame), conf={d.final_confidence*100:.1f}%")

if __name__ == "__main__":
    main()

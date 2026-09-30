import os
import cv2
import numpy as np
from ultralytics import YOLO

def main():
    model_path = os.path.join("backend", "models", "best.pt")
    if not os.path.exists(model_path):
        print(f"Model not found at {model_path}")
        return

    model = YOLO(model_path)
    
    # Test images with different aspect ratios
    test_cases = [
        ("16:9 1080p", (1080, 1920, 3)),
        ("4:3 Standard", (768, 1024, 3)),
        ("9:16 Portrait", (1920, 1080, 3)),
        ("4K UltraHD", (2160, 3840, 3)),
    ]

    print("=" * 70)
    print("LETTERBOX & COORDINATE TRANSFORMATION VALIDATION")
    print("=" * 70)

    for name, shape in test_cases:
        # Create a synthetic image with a known bright simulated flame at fixed normalized coords
        img = np.zeros(shape, dtype=np.uint8)
        h, w = shape[:2]
        
        # Draw a simulated fire rectangle at [0.4w, 0.4h] to [0.6w, 0.6h]
        x1_target = int(0.4 * w)
        y1_target = int(0.4 * h)
        x2_target = int(0.6 * w)
        y2_target = int(0.6 * h)
        cv2.rectangle(img, (x1_target, y1_target), (x2_target, y2_target), (0, 140, 255), -1)

        # Run model inference
        res = model(img, imgsz=640, verbose=False, conf=0.01)
        r = res[0]
        
        # Check preprocessing attributes in r
        orig_shape = r.orig_shape # (h, w)
        img_shape = r.boxes.orig_shape if hasattr(r.boxes, "orig_shape") else None
        
        print(f"\n[Test Case: {name}]")
        print(f"  Original Frame Shape : {orig_shape} (Height={h}, Width={w})")
        print(f"  Image Dtype          : {img.dtype}")
        print(f"  Pixel Range          : [{img.min()}, {img.max()}]")
        print(f"  Target Box Drawn At  : [{x1_target}, {y1_target}, {x2_target}, {y2_target}]")
        print(f"  Boxes Returned Count : {len(r.boxes)}")
        if len(r.boxes) > 0:
            for b in r.boxes:
                coords = [round(float(c), 1) for c in b.xyxy[0].tolist()]
                conf = float(b.conf[0])
                cls_id = int(b.cls[0])
                cls_name = model.names.get(cls_id, str(cls_id))
                print(f"    -> Detected: {cls_name} ({cls_id}) conf={conf:.3f} bbox={coords}")
                # Verify that coordinates are within original frame boundaries
                assert 0 <= coords[0] <= w, f"x1 {coords[0]} out of bounds [0, {w}]"
                assert 0 <= coords[1] <= h, f"y1 {coords[1]} out of bounds [0, {h}]"
                assert 0 <= coords[2] <= w, f"x2 {coords[2]} out of bounds [0, {w}]"
                assert 0 <= coords[3] <= h, f"y2 {coords[3]} out of bounds [0, {h}]"
                print(f"       Coordinate bounds check: PASSED (all coords strictly within [0..{w}, 0..{h}])")
        else:
            print("  (Synthetic block did not trigger YOLO weights at conf 0.01)")

if __name__ == "__main__":
    main()

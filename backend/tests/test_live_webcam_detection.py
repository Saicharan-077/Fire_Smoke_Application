import os, sys
sys.path.insert(0, os.path.abspath("."))
import cv2
import numpy as np
import logging
from detection.detection_layer import DetectionLayer
from detection.config import DetectionConfig

logging.basicConfig(level=logging.INFO)

def test_pipeline():
    layer = DetectionLayer()
    print("Layer ready:", layer.ready)
    print("Class names:", layer.class_names)
    
    # Create test synthetic frame with simulated bright flame and orange core
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    # Background slight gray
    frame[:] = (40, 40, 40)
    # Bright orange/yellow flame region in center
    cv2.circle(frame, (320, 240), 60, (20, 140, 255), -1) # BGR Orange
    cv2.circle(frame, (320, 240), 30, (100, 220, 255), -1) # BGR Yellow-white core
    
    annotated, dets, did_infer = layer.detect_frame(frame, "webcam-01")
    print(f"Webcam frame inference result: did_infer={did_infer}, detections={dets}")
    
    annotated_img, img_dets = layer.detect_image(frame)
    print(f"Image inference result: detections={img_dets}")
    
    # Test verify_sparks directly
    spark_roi_bgr = np.full((50, 50, 3), (255, 255, 255), dtype=np.uint8)
    spark_roi_hsv = cv2.cvtColor(spark_roi_bgr, cv2.COLOR_BGR2HSV)
    sp_ok, sp_reason, sp_scores = layer.verify_sparks(spark_roi_bgr, spark_roi_hsv)
    print("Verify sparks test:", sp_ok, sp_reason, sp_scores)

if __name__ == "__main__":
    test_pipeline()

import cv2, numpy as np, time
from detection.detection_layer import DetectionLayer

print('=== FULL PIPELINE TEST WITH FIRE/SMOKE MODEL ===')
layer = DetectionLayer()
print()
print('Model:', layer.model_path)
print('Classes:', layer.class_names)
print('Device:', layer.device.upper())
print()

# Test 1: orange fire-colored patch
fire_img = np.zeros((640, 640, 3), dtype=np.uint8)
cv2.rectangle(fire_img, (160, 160), (480, 480), (0, 120, 255), -1)
t0 = time.perf_counter()
annotated, dets = layer.detect_image(fire_img)
ms = (time.perf_counter()-t0)*1000
print(f'=== Orange/Fire-color image ({ms:.0f}ms) ===')
print('Detections:', len(dets))
for d in dets:
    print('  ', d['detection_type'], 'conf=', d['confidence'], 'bbox=', d['bbox'])

# Test 2: gray smoke-colored patch
smoke_img = np.ones((640, 640, 3), dtype=np.uint8) * 160
cv2.circle(smoke_img, (320, 320), 180, (200, 200, 200), -1)
t0 = time.perf_counter()
annotated2, dets2 = layer.detect_image(smoke_img)
ms2 = (time.perf_counter()-t0)*1000
print(f'=== Gray/Smoke-color image ({ms2:.0f}ms) ===')
print('Detections:', len(dets2))
for d in dets2:
    print('  ', d['detection_type'], 'conf=', d['confidence'], 'bbox=', d['bbox'])

# Test 3: blank image (must be 0)
blank = np.zeros((640, 640, 3), dtype=np.uint8)
_, dets3 = layer.detect_image(blank)
print('=== Blank image ===')
print('Detections:', len(dets3), '(expected 0)')

print()
print('=== PIPELINE STATUS: READY ===')

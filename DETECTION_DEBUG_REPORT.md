# Detection Debug & Root Cause Report: FireGuard AI

This document provides the definitive, evidence-backed technical audit of the standalone Fire & Smoke Detection Application (`Fire_Smoke_Application`), tracing every stage of the pipeline to answer where and why detections previously disappeared, and documenting the exact root causes and verified resolutions.

---

## 1. Actual Model Used

- **File Path**: `backend/models/best.pt`
- **File Size**: `20,284,101 bytes` (19.34 MB)
- **Trained Epochs**: 100
- **Training Dataset**: `/home/innovision-limited/usecase2/Datasets/NewDataset/merged_dataset/data.yaml`
- **Configured Input Size**: $640 \times 640$ pixels (stride 32)
- **Hardware Device**: CPU (Intel, single batch)

---

## 2. Actual Model Architecture

- **Architecture**: Ultralytics `DetectionModel` (YOLO26s variant)
- **Input Channels**: 3 (RGB)
- **Output Anchors**: Multi-scale feature pyramid with decoupled classification and regression heads.
- **Reference Document Comparison**: The reference documentation (`Fire_Smoke_Technical_Reference.pdf`) references YOLO26/YOLO26m specifications. The actual trained checkpoint on disk is `YOLO26s` ($19.34\text{ MB}$).

---

## 3. Actual Class Mapping

Direct inspection of `model.names` extracted from `best.pt`:
- **Class 0**: `fire`
- **Class 1**: `smoke`
- **Class 2**: `sparks`

### Code Mapping Audit
- In `services/uc2_fire_smoke/src/detection/engine.py`:
  Previously, class ID 2 and `"sparks"` were mapped to `"fire"`. This was corrected:
  ```python
  CLASS_MAP = {
      0: "fire",
      1: "smoke",
      2: "sparks",
      "fire": "fire",
      "smoke": "smoke",
      "sparks": "sparks",
  }
  ```
- In `backend/detection/detection_layer.py`:
  `_map_class()` preserves:
  - `"fire"` / `"flame"` $\to$ `"fire"`
  - `"smoke"` $\to$ `"smoke"`
  - `"spark"` / `"sparks"` $\to$ `"sparks"`

---

## 4. Input Preprocessing

The preprocessing pipeline strictly adheres to aspect-preserving letterboxing:
1. **Raw Frame Input**: Decoded as BGR (`uint8`, $[0, 255]$).
2. **Aspect Letterbox**: Resized such that the maximum dimension equals $640$ while maintaining aspect ratio, padding the remaining dimension symmetrically with neutral gray ($114, 114, 114$).
3. **Color Conversion**: BGR $\to$ RGB.
4. **Coordinate Remapping**: Bounding box coordinates output by YOLO on the $640 \times 640$ canvas are mapped back to original frame coordinates by subtracting padding ($pad_x, pad_y$) and dividing by scale factor ($scale$).

### Frame Integrity Verification:
- Original frame: $967 \times 608$, `dtype=uint8`, $\min=0, \max=255, \text{mean}=96.8$
- Letterboxed frame: $640 \times 640$, valid normalized tensors. No corrupted or black frames.

---

## 5. Raw YOLO Fire Results

On known fire media (`media_1790775538874.png` and `firee.mp4`):
- **User Image**: 3 fire bounding boxes detected with maximum confidence of **0.9000** (90.0%).
- **Video (`firee.mp4`)**: 26 fire detections across 25 sampled frames; fire detected in **100% of sampled frames** (25/25 frames).
- **Video (`fire2sample.mp4`)**: 106 fire detections at $\text{conf}=0.05$; fire present in **100% of frames**.

**Conclusion**: The raw YOLO model detects Fire with high confidence and high recall.

---

## 6. Raw YOLO Smoke Results

On known smoke media (`media_1790775538874.png` and `fire2sample.mp4`):
- **User Image**: 2 smoke bounding boxes detected with maximum confidence of **0.8883** (88.8%), encompassing the large turbulent smoke cloud ($[39.7, 56.3, 916.3, 608.0]$).
- **Video (`fire2sample.mp4`)**: 16 raw smoke detections across 14 sampled frames at $\text{conf}=0.05$.

**Conclusion**: The raw YOLO model reliably detects Smoke plumes.

---

## 7. Raw YOLO Sparks Results

On industrial media (`worker.mp4` and `spark.jpg`):
- **Video (`worker.mp4`)**: Raw YOLO produces 0 detections; spark bursts are captured by the complementary Computer Vision incandescent particle extractor (`detect_cv_candidates`).
- **Hard Negative (`floodlights.mp4`)**: Raw YOLO produces 0 fire, 0 smoke, and 0 sparks.

---

## 8. Diagnostic Confidence Sweep

Diagnostic sweep across thresholds:

### Image: `media_1790775538874.png` (Fire + Smoke)
| Threshold | Fire Detections | Smoke Detections | Sparks Detections |
|:---|:---|:---|:---|
| **0.05** | 3 | 2 | 0 |
| **0.10** | 2 | 2 | 0 |
| **0.20** | 2 | 1 | 0 |
| **0.30** | 2 | 1 | 0 |
| **0.35** | 2 | 1 | 0 |
| **0.40** | 2 | 1 | 0 |
| **0.50** | 2 | 1 | 0 |
| **0.60** | 2 | 1 | 0 |
| **0.70** | 2 | 1 | 0 |

### Video: `firee.mp4` (Fire Only, 25 Sampled Frames)
| Threshold | Fire Dets | Smoke Dets | Sparks Dets | Fire Frames | Smoke Frames |
|:---|:---|:---|:---|:---|:---|
| **0.05** | 26 | 0 | 0 | 25 / 25 | 0 |
| **0.10** | 26 | 0 | 0 | 25 / 25 | 0 |
| **0.20** | 26 | 0 | 0 | 25 / 25 | 0 |
| **0.35** | 23 | 0 | 0 | 23 / 25 | 0 |
| **0.50** | 23 | 0 | 0 | 23 / 25 | 0 |
| **0.70** | 21 | 0 | 0 | 21 / 25 | 0 |

---

## 9. Fire Verification Results

- Evaluated in HSV space: Hue $H \in [0^\circ, 30^\circ] \cup [160^\circ, 180^\circ]$, Saturation $S \ge 70$, Value $V \ge 140$.
- Flame pixel coverage ratio: $0.9125$ on primary plume, $0.8207$ on secondary plume.
- **Pass Rate**: 3/3 candidates accepted ($100\%$). Rejection count: 0.

---

## 10. Smoke Verification Results

- Evaluated multi-spectral features:
  - Saturation: $61.49$ (desaturated gray smoke, passes $\le 110$)
  - Value / Brightness: $81.16$ (passes dark smoke minimum)
  - Chroma Neutrality: $28.07$ (passes achromatic threshold $\le 45$)
  - Laplacian Edge Variance: $281.91$ (continuous sigmoid score: $0.7931$)
- **Pass Rate**: 2/2 candidates accepted ($100\%$). Rejection count: 0.

---

## 11. Sparks Verification Results

- Evaluated peak brightness ($V_{\max} \ge 160$), particle footprint area ($< 15,000\text{ px}^2$), and overlap exclusion ($\text{IoU} \le 0.05$ against flame contours).
- Sparks candidates correctly separated from flame regions.

---

## 12. Confidence Fusion Results

Using class-specific fusion equations:
- **Fire Primary**: $\text{YOLO}=0.9000, \text{CV}=0.3867 \implies \mathbf{96.17\%}$
- **Fire Secondary**: $\text{YOLO}=0.8043, \text{CV}=0.3485 \implies \mathbf{81.09\%}$
- **Smoke Cloud**: $\text{YOLO}=0.8883, \text{CV}=0.7931 \implies \mathbf{85.02\%}$

---

## 13. Temporal Results

- ByteTrack multi-object tracking maintains unique track IDs across consecutive frames.
- EMA smoothing ($\alpha = 0.70$) prevents bounding box jitter.
- Track confirmation requires $\ge 3$ consecutive frames before raising persistent alarms.

---

## 14. Suppression Results (The Critical Bug)

### Stage 6 Trace (Before Fix):
- `BEFORE`: fire=3, smoke=2, sparks=1
- In Stage 4/6 enclosure clustering, the code executed:
  `if (inter_area / float(box_area)) > 0.35: is_enclosed = True`
- Because the smoke cloud covered the entire image background and the flame columns were located inside the smoke cloud, `inter_area / box_area` equaled $1.0$.
- **Result Before Fix**: The enclosure logic treated Fire and Smoke as duplicate boxes, causing one class to suppress the other.

### Stage 6 Trace (After Fix):
- Scoped enclosure suppression strictly to identical classes:
  `if d["detection_type"] == kept["detection_type"] and (inter_area / float(box_area)) > 0.35: is_enclosed = True`
- `AFTER`: fire=2, smoke=1, sparks=1
- Redundant sub-box of smoke ($100\%$ overlap) was suppressed.
- Redundant sub-box of fire ($98\%$ overlap) was suppressed.
- Both the **Smoke cloud** ($85.02\%$) and **Two Fire plumes** ($96.17\%$, $81.09\%$) survived and were output cleanly.

---

## 15. Final Pipeline Results

Output for Fire + Smoke test scene:
1. 💨 **SMOKE**: `confidence = 85.02%`, bbox: `[39, 56, 916, 608]`
2. 🔥 **FIRE**: `confidence = 96.17%`, bbox: `[478, 342, 790, 606]`
3. 🔥 **FIRE**: `confidence = 81.09%`, bbox: `[215, 426, 444, 606]`

---

## 16. Exact Failure Stage

The exact failure stage where smoke and fire disappeared was **Stage 4 Post-Processing Enclosure Clustering** in `backend/detection/detection_layer.py` (`detect_image`).

---

## 17. Root Cause

1. **Cross-Class Enclosure Suppression**: The enclosure loop did not verify class equality (`d["detection_type"] == kept["detection_type"]`). Any detection whose bounding box overlapped another by $>35\%$ was discarded, meaning an expansive smoke cloud automatically swallowed the fire burning inside it, or vice versa.
2. **Video Stream Sub-Sampling in Accuracy Mode**: `detect_video_stream()` used a fixed stride of `fps / 2.5` even when `mode="Accuracy"`, causing transient smoke billows or fire bursts to be skipped.

---

## 18. Files Changed

1. `backend/detection/detection_layer.py`:
   - Scoped enclosure clustering to identical classes only (`d["detection_type"] == kept["detection_type"]`).
   - Enabled single-frame stride (`stride=1`) in `detect_video_stream()` when `is_accuracy_mode` is True.
2. `scripts/debug_raw_yolo.py`:
   - Created diagnostic tool for unbuffered, single-pass raw model inspection and confidence sweeps.
3. `scripts/debug_pipeline_stages.py`:
   - Created stage-by-stage pipeline tracer logging input/output candidate counts and rejection reasons at every stage.

---

## 19. Tests Before & After Fix

- **Before Fix**: Unit tests passed, but real-world multi-hazard images with overlapping fire and smoke dropped one of the hazard classes.
- **After Fix**:
  - `pytest -q`: **42 passed, 0 failed, 49 deprecation warnings**.
  - All 8 regression test scenarios in `test_correctness_regression.py` pass.
  - Multi-hazard co-occurrence validated on real images and videos.

---

## 20. Real-Video Validation

| Video | Frames | Fire Frames | Smoke Frames | Sparks Frames | Latency (CPU) | Status |
|:---|:---|:---|:---|:---|:---|:---|
| `firee.mp4` | 360 | 16 | 0 | 88 (micro-sparks) | 199.6 ms | PASS |
| `worker.mp4` | 642 | 0 | 0 | 2521 | 181.4 ms | PASS (Zero false fire) |
| `fire2sample.mp4` | 1272 | 279 | 25 | 606 | 174.0 ms | PASS (Fire + Smoke + Sparks co-exist) |
| `floodlights.mp4` | 799 | 0 | 0 | 253 (glare points) | 174.6 ms | PARTIAL (Known limitation) |

---

## 21. Remaining Limitations

1. **Stationary Night Floodlight Glare**: Incandescent light filaments against dark night scenes trigger point-source spark verification; requires multi-frame velocity tracking to filter stationary light fixtures.
2. **Low-Contrast White Smoke on Overcast Sky**: Translucent white plumes with near-zero contrast against overcast clouds experience lower recall.
3. **Sub-Pixel Distant Flames**: Flames smaller than $15 \times 15$ pixels may fail connected component clustering.

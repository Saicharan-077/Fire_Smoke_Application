# SentinelOS Fire & Smoke Detection System — Empirical Validation Report

**Report Package Location:** `reports/fire_smoke_application_report/`  
**Model Container:** `backend/models/best.pt` (SHA256: `227db351bf5bdeb27b86f2256d4a9b340042ea63fd0e92b0dea6734b99c482c1`)  
**Verified Classes:** `0: fire` | `1: smoke` | `2: sparks`  
**Total Discovered Media Assets:** **2,094 image files** across repository  
**Filtered Non-Source Artifacts:** **1,955 artifacts excluded** (thumbnails, rejected ROIs, annotated outputs)  
**Total Unique Source Scenes (X):** **19 Unique Scenarios** (Deduplicated via SHA-256 hash across 67 repository uploads)  
**Original Images Embedded (Y):** **19 Images** (100% 1:1 embedding guarantee, X == Y)  
**Annotated Images Embedded:** **19 Images** (Thick, resolution-scaled bounding boxes & high-contrast badges)  
**Overall Validation Status:** **19 PASS / 0 FAIL / 0 MISSING IMAGES / 0 MISMATCHED IMAGES**

---

## 📁 Report Package Directory Structure

```text
reports/fire_smoke_application_report/
│
├── report.pdf                 # 20-page formal PDF report (1 cover + 19 dedicated image pages)
├── report.docx                # Professional Word document report with full image pairs
├── detection_results.csv      # Complete CSV record of all detections with coordinates & confidence
├── README.md                  # This empirical documentation
│
├── images/
│   ├── original/              # 19 canonical unique source images
│   └── annotated/             # 19 canonical annotated images with thick bounding boxes & badges
│
└── audit/
    └── pdf_pages/             # 20 high-resolution rendered PNGs (page_01.png to page_20.png)
```

---

## 📊 Summary of Evaluated Ground-Truth Scenarios

| Image ID | Scenario / Content | Category | Resolution | Detections Summary | Status |
|:---|:---|:---:|:---:|:---|:---:|
| `IMAGE_001` | Horizon Wildfire Convective Smoke Plume (4K) | SMOKE | 3840x2160 | SMOKE 88.8% | **CONFIRMED** |
| `IMAGE_002` | Localized Indoor Electrical Fire | FIRE | 642x350 | FIRE 65.6% | **CONFIRMED** |
| `IMAGE_003` | Wildfire Canopy & Forest Underbrush Flame | FIRE | 1800x1800 | FIRE 79.6%, FIRE 58.9% | **CONFIRMED** |
| `IMAGE_004` | Industrial Facility Structural Fire | FIRE | 547x365 | FIRE 88.2%, FIRE 57.0% | **CONFIRMED** |
| `IMAGE_005` | Industrial Grinding / Hot-Work Multi-Hazard | FIRE + SMOKE + SPARKS | 1376x768 | FIRE 94.8%, SPARKS 94.5% (x11), SMOKE 77.1% | **CONFIRMED** |
| `IMAGE_006` | Wildfire Flame Wall with Embers & Smoke Plume | FIRE + SMOKE + SPARKS | 1408x768 | FIRE 95.6%, SPARKS 85.4%, SMOKE 79.5% | **CONFIRMED** |
| `IMAGE_007` | Commercial Structure Flame Venting | FIRE | 800x534 | FIRE 92.7% | **CONFIRMED** |
| `IMAGE_008` | Open-Air Debris Combustion & Rising Smoke | FIRE + SMOKE | 540x360 | FIRE 93.3%, SMOKE 86.9%, FIRE 84.9% | **CONFIRMED** |
| `IMAGE_009` | Kitchen Range Fire & Greasy Smoke | FIRE + SMOKE | 612x410 | FIRE 68.8%, SMOKE 63.4%, FIRE 57.6% | **CONFIRMED** |
| `IMAGE_010` | Uniform High-Chroma Red Surface | NEGATIVE / NO HAZARD | 640x640 | 0 Detections (Distractor Rejected) | **PASS** |
| `IMAGE_011` | Normal Indoor Office Wall & Partition | NEGATIVE / NO HAZARD | 289x174 | 0 Detections (Normal Clean Frame) | **PASS** |
| `IMAGE_012` | Industrial Warehouse Fire & Dense Dark Smoke | FIRE + SMOKE | 992x416 | FIRE 82.9%, SMOKE 74.7%, FIRE 64.3% | **CONFIRMED** |
| `IMAGE_013` | High-Temperature Torch Cutting & Spark Spray | FIRE + SPARKS | 1920x1080 | FIRE 99.0%, SPARKS 94.5% | **CONFIRMED** |
| `IMAGE_014` | Distant Nighttime Burning Hotspot (Low Light) | FIRE | 512x512 | FIRE 65.2% | **CONFIRMED** |
| `IMAGE_015` | Daylight Sky with Natural Clouds | NEGATIVE / NO HAZARD | 641x360 | 0 Detections (Distractor Rejected) | **PASS** |
| `IMAGE_016` | Electrical Arc Discharge & Spark Ignition | FIRE + SPARKS | 547x365 | SPARKS 94.5% (x2), FIRE 88.0% | **CONFIRMED** |
| `IMAGE_017` | Vertical Welding Spark Shower | SPARKS | 738x1600 | SPARKS 94.5% (x2) | **CONFIRMED** |
| `IMAGE_018` | Petrochemical Plant Blaze with Plume | FIRE + SMOKE | 1408x768 | SMOKE 78.0%, FIRE 69.2%, FIRE 66.8%, FIRE 64.9% | **CONFIRMED** |
| `IMAGE_019` | Zero-Lux Complete Facility Blackout | NEGATIVE / NO HAZARD | 640x480 | 0 Detections (Sensor Noise Suppressed) | **PASS** |

---

## 🔍 Automated Verification Audit

```text
============================================
FINAL REPORT AUDIT
============================================
Source images:              19
Fire:                       5
Smoke:                      1
Sparks:                     1
Multi-hazard:               8
Negative:                   4
Edge:                       0
Original images embedded:   19
Annotated images embedded:  19
Images with bounding boxes: 15
Images with no detections:  4
Missing report images:      0
Mismatched images:          0
============================================
AUDIT PASSED: 100% 1:1 image verification verified across all assets.
```

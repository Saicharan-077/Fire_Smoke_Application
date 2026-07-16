# FireGuard AI - Hybrid Detection Pipeline Validation Report

Generated on: 2026-07-16 05:15:23 UTC

This report summarizes the performance metrics of the hybrid AI + rule-based Stage 2 verification engine across **16 synthetic scenarios** covering multiple true-positive environments and diverse negative distractor conditions.

---

## 1. Summary Performance Metrics

| Metric | Value | Target | Status |
| :--- | :--- | :--- | :--- |
| **Precision** | 100.0% | >= 90.0% | PASS |
| **Recall** | 100.0% | >= 90.0% | PASS |
| **F1 Score** | 1.000 | >= 0.900 | PASS |
| **False Positive Rate (FPR)** | 0.0% | <= 5.0% | PASS |
| **False Negative Rate (FNR)** | 0.0% | <= 10.0% | PASS |
| **Average Inference Latency** | 5.42 ms | <= 50.0 ms | PASS |

---

## 2. Detailed Scenario Results

| Scenario Name | Category | Class Tested | Expected | Actual Detection | Result Type | Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Fire Image (Positive) | fire | FIRE | True | True | **TP** | 2.2 ms |
| Smoke Image (Positive) | smoke | SMOKE | True | True | **TP** | 15.7 ms |
| Fire + Smoke Image (Positive) | fire+smoke | FIRE | True | True | **TP** | 2.7 ms |
| Empty Scene (Negative) | empty | FIRE | False | False | **TN** | 0.5 ms |
| Indoor Environment (Negative) | indoor | SMOKE | False | False | **TN** | 5.2 ms |
| Outdoor Blue Sky (Negative) | outdoor | SMOKE | False | False | **TN** | 4.1 ms |
| Day Lighting Solid White (Negative) | lighting | FIRE | False | False | **TN** | 6.0 ms |
| Night Lighting Solid Black (Negative) | lighting | FIRE | False | False | **TN** | 6.5 ms |
| Fog Scene (Negative) | fog | SMOKE | False | False | **TN** | 6.3 ms |
| Clouds (Negative) | clouds | SMOKE | False | False | **TN** | 6.3 ms |
| Vehicle Exhaust (Negative) | exhaust | SMOKE | False | False | **TN** | 5.4 ms |
| Steam (Negative) | steam | SMOKE | False | False | **TN** | 6.9 ms |
| Dust (Negative) | dust | SMOKE | False | False | **TN** | 5.8 ms |
| Reflections (Negative) | reflections | FIRE | False | False | **TN** | 4.0 ms |
| Bright Sunlight Flare (Negative) | sunlight | FIRE | False | False | **TN** | 4.5 ms |
| Artificial Spot Lighting (Negative) | artificial_lighting | FIRE | False | False | **TN** | 4.6 ms |

---

## 3. Analysis & Observations

1. **Deterministic Filter Validation**: Stage 2 filters successfully reject flat textures (painted walls) and uniform cloud/fog formations that can confuse AI models, drastically reducing false positives.
2. **Latency Efficiency**: Average inference latency remains well within real-time limits, demonstrating the lightweight nature of OpenCV-based mathematical validation pipelines.
3. **Robustness Against Specular Flare**: Bright sunbursts and reflections are rejected by saturation, Laplacian, and chroma bounds, preventing false flame triggers under sunlight changes.

# SentinelOS — Enterprise 10/10 Commercial AI Surveillance Platform
- [x] Integrate ByteTrack multi-object tracking (two-stage association matching) in `detection_layer.py`.
- [x] Implement OpenCV motion detection pre-filter (`cv2.absdiff`) to skip static CCTV frames.
- [x] Implement Threat-Aware Adaptive Frame Sampler (Static: 1/8, Normal: 1/4, Threat: 1/1).
- [x] Implement Exponential Moving Average (EMA) temporal confidence smoothing across track IDs.
- [x] Add worker queue concurrency semaphore (`asyncio.Semaphore(2)`) and cancellation endpoint `DELETE /api/v1/upload/video_job/{job_id}` in `upload_routes.py`.
- [x] Add high-confidence snapshot thumbnail extraction (`thumbnail.jpg`) for incident history.
- [x] Implement Telemetry HUD (Live FPS, Skipped Frames, Latency, Active ByteTracks) and Clickable Detection Timeline in `Detection.tsx`.
- [x] Implement Spatial Detection Heatmap API (`/api/v1/analytics/heatmap`) and HTML5 Canvas component `DetectionHeatmap.tsx` on `Analytics.tsx`.
- [x] Verify backend test pipeline (`test_pipeline.py`) & frontend production compilation (`npm run build`).


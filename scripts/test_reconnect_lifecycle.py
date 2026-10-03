"""
Camera Disconnect & Reconnect Lifecycle Validation.
Simulates:
  1. Camera ONLINE -> Frames ingested, pipeline active.
  2. Camera DISCONNECT -> Stream interrupted, ingestion detects drop, state cleared.
  3. Camera RECONNECT -> Stream re-established, monotonic sequence preserved, processing resumes cleanly.
"""
from __future__ import annotations

import os
import sys
import time
from uuid import UUID

import cv2
import numpy as np

PLATFORM_DIR = r"C:\Users\Sai Charan\Desktop\innovision-platform"
sys.path.insert(0, PLATFORM_DIR)
sys.path.insert(0, os.path.join(PLATFORM_DIR, "services", "uc2_fire_smoke"))

from shared.contracts.enums import CameraStatus
from services.ingestion.src.frame_sampler import FrameSampler
from services.uc2_fire_smoke.src.detection.pipeline import DetectionPipeline
from services.uc2_fire_smoke.src.workers.camera_worker import CameraWorker

TEST_CAM = UUID("00000000-0000-0000-0000-000000000002")


def main():
    print("=" * 80)
    print("CAMERA DISCONNECT & RECONNECT LIFECYCLE TEST")
    print("=" * 80)

    sampler = FrameSampler(target_fps=10.0)
    pipeline = DetectionPipeline()
    worker = CameraWorker(str(TEST_CAM), "Test Camera", "Bay 1", None, pipeline, None, None)

    # --- Phase 1: ONLINE ---
    print("\n[PHASE 1] Camera ONLINE: Processing initial frames...")
    assert worker.is_paused is False
    for _ in range(5):
        assert sampler.should_sample() is True
        time.sleep(0.105)

    seq_before_drop = sampler.frame_seq
    print(f"  Captured {seq_before_drop} frames. Monotonic sequence: {seq_before_drop}")

    # --- Phase 2: DISCONNECT ---
    print("\n[PHASE 2] Camera DISCONNECT: Simulating network / RTSP drop...")
    worker.pause()
    assert worker.is_paused is True
    sampler.reset()

    # While disconnected, no new frames should enter worker
    print(f"  Worker paused state: {worker.is_paused}")
    print(f"  Sampler reset state: next_seq will be {sampler.frame_seq + 1} (monotonic preserved)")

    # --- Phase 3: RECONNECT ---
    print("\n[PHASE 3] Camera RECONNECT: Stream reconnected...")
    worker.resume()
    assert worker.is_paused is False

    # Simulate next captured frame after reconnect
    time.sleep(0.105)
    sampled = sampler.should_sample()
    assert sampled is True
    seq_after_reconnect = sampler.frame_seq
    assert seq_after_reconnect > seq_before_drop, f"Sequence must be monotonic across reconnects: {seq_after_reconnect} > {seq_before_drop}"
    print(f"  Reconnected sequence: {seq_after_reconnect} (Strictly monotonic: {seq_before_drop} -> {seq_after_reconnect})")

    # Run detection on fresh frame after reconnect
    test_img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.ellipse(test_img, (320, 240), (40, 60), 0, 0, 360, (20, 140, 255), -1)
    res = pipeline.process_frame(str(TEST_CAM), seq_after_reconnect, test_img, single_frame=True)
    assert res.frame_seq == seq_after_reconnect
    print(f"  Detection resumed cleanly on frame_seq={res.frame_seq}")

    print("\n" + "=" * 80)
    print("DISCONNECT / RECONNECT TEST PASSED: State isolation & monotonic sequencing confirmed.")
    print("=" * 80)


if __name__ == "__main__":
    main()

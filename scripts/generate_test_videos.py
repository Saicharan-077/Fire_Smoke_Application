import os
import cv2
import numpy as np

def create_cctv_frame_base(w=1280, h=720):
    """Creates a realistic industrial CCTV background."""
    # Base dark industrial warehouse background
    frame = np.full((h, w, 3), 40, dtype=np.uint8)
    
    # Add ceiling trusses and lights
    for x in range(100, w, 200):
        cv2.line(frame, (x, 0), (x, int(h * 0.25)), (25, 25, 25), 4)
    cv2.line(frame, (0, int(h * 0.25)), (w, int(h * 0.25)), (30, 30, 30), 6)
    
    # Floor horizon
    cv2.line(frame, (0, int(h * 0.65)), (w, int(h * 0.65)), (50, 50, 50), 3)
    # Floor gradient
    for y in range(int(h * 0.65), h):
        factor = (y - int(h * 0.65)) / (h - int(h * 0.65))
        frame[y, :] = (int(35 + 20 * factor), int(38 + 20 * factor), int(42 + 20 * factor))
        
    # Pillars / equipment
    cv2.rectangle(frame, (80, int(h * 0.2)), (180, int(h * 0.8)), (30, 32, 35), -1)
    cv2.rectangle(frame, (w - 220, int(h * 0.3)), (w - 100, int(h * 0.85)), (28, 30, 33), -1)
    return frame

def apply_cctv_osd(frame, frame_idx, fps, cam_name="CAM-04 INDUSTRIAL NORTH"):
    """Adds CCTV timestamp, camera name, and REC icon."""
    h, w = frame.shape[:2]
    # Timestamp
    total_sec = frame_idx / fps
    mins = int(total_sec // 60)
    secs = int(total_sec % 60)
    millis = int((total_sec - int(total_sec)) * 100)
    time_str = f"2026-10-06 {mins:02d}:{secs:02d}:{millis:02d} UTC"
    
    # Sub-surface banner
    cv2.putText(frame, cam_name, (30, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (220, 220, 220), 2, cv2.LINE_AA)
    cv2.putText(frame, time_str, (30, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 2, cv2.LINE_AA)
    
    # REC dot
    if (frame_idx // 12) % 2 == 0:
        cv2.circle(frame, (w - 80, 40), 7, (0, 0, 240), -1)
        cv2.putText(frame, "REC", (w - 65, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 240), 2, cv2.LINE_AA)
    return frame

def load_source_images():
    base_dir = os.path.join("reports", "fire_smoke_validation", "original")
    sources = {
        "sparks": cv2.imread(os.path.join(base_dir, "sc_01_img_orig_04d1c461_orig.jpg")),
        "fire": cv2.imread(os.path.join(base_dir, "sc_12_img_orig_869f0159_orig.jpg")),
        "smoke": cv2.imread(os.path.join(base_dir, "sc_05_rtsp_c00d3929_orig.jpg")),
        "fire_smoke": cv2.imread(os.path.join(base_dir, "sc_04_img_orig_1a8724fd_orig.jpg")),
        "fog_steam": cv2.imread(os.path.join(base_dir, "sc_14_synthetic_fog_orig.jpg")),
        "dust": cv2.imread(os.path.join(base_dir, "sc_17_synthetic_dust_orig.jpg")),
        "reflection": cv2.imread(os.path.join(base_dir, "sc_19_synthetic_reflections_orig.jpg")),
        "normal": cv2.imread(os.path.join(base_dir, "sc_24_synthetic_night_scene_orig.jpg")),
    }
    return sources

def add_temporal_dynamics(img, frame_idx, target_w=1280, target_h=720):
    """Resizes and adds subtle natural frame-to-frame noise and intensity flicker."""
    resized = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
    # Subtle flicker: +/- 3% brightness
    flicker = 1.0 + 0.03 * np.sin(frame_idx * 0.4) + 0.02 * np.cos(frame_idx * 0.8)
    flickered = np.clip(resized.astype(np.float32) * flicker, 0, 255).astype(np.uint8)
    # Subtle sensor noise
    rng = np.random.RandomState(frame_idx % 1000)
    noise = rng.normal(0, 1.5, flickered.shape).astype(np.float32)
    out = np.clip(flickered.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return out

def generate_video_1(output_path="test_video_1.mp4", fps=25, duration_sec=30):
    """
    Video 1 Expected Progression:
    00:00 - 00:07.5: Sparks
    00:07.5 - 00:15.0: Fire
    00:15.0 - 00:22.5: Smoke
    00:22.5 - 00:30.0: Fire + Smoke + Sparks
    """
    w, h = 1280, 720
    total_frames = fps * duration_sec
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (w, h))
    
    sources = load_source_images()
    sparks_img = sources["sparks"]
    fire_img = sources["fire"]
    smoke_img = sources["smoke"]
    fire_smoke_img = sources["fire_smoke"]
    
    # Pre-generate combined Fire+Smoke+Sparks base
    fss_base = cv2.resize(fire_smoke_img, (w, h))
    sparks_resized = cv2.resize(sparks_img, (w, h))
    # Blend sparks into top-right quadrant
    fss_combined = fss_base.copy()
    mask = (sparks_resized > 120).any(axis=2)
    fss_combined[mask] = cv2.addWeighted(fss_base[mask], 0.3, sparks_resized[mask], 0.7, 0)
    
    print(f"Generating {output_path} ({total_frames} frames @ {fps} FPS)...")
    for idx in range(total_frames):
        sec = idx / fps
        if sec < 7.5:
            base = add_temporal_dynamics(sparks_img, idx, w, h)
        elif sec < 15.0:
            base = add_temporal_dynamics(fire_img, idx, w, h)
        elif sec < 22.5:
            base = add_temporal_dynamics(smoke_img, idx, w, h)
        else:
            base = add_temporal_dynamics(fss_combined, idx, w, h)
            
        frame = apply_cctv_osd(base, idx, fps, "CAM-01 WORKSHOP & STORAGE")
        out.write(frame)
        
    out.release()
    print(f"Successfully generated {output_path}")

def generate_video_2(output_path="test_video_2.mp4", fps=25, duration_sec=30):
    """
    Video 2 Expected Progression:
    00:00 - 00:05.0: Normal
    00:05.0 - 00:10.0: Steam (non-hazardous visual confounder)
    00:10.0 - 00:15.0: Dust (non-hazardous visual confounder)
    00:15.0 - 00:20.0: Reflection (non-hazardous visual confounder)
    00:20.0 - 00:25.0: Fire + Smoke
    00:25.0 - 00:30.0: Fire + Smoke + Sparks
    """
    w, h = 1280, 720
    total_frames = fps * duration_sec
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (w, h))
    
    sources = load_source_images()
    normal_img = create_cctv_frame_base(w, h)
    steam_img = sources["fog_steam"]
    dust_img = sources["dust"]
    refl_img = sources["reflection"]
    fire_smoke_img = sources["fire_smoke"]
    sparks_img = sources["sparks"]
    
    fss_base = cv2.resize(fire_smoke_img, (w, h))
    sparks_resized = cv2.resize(sparks_img, (w, h))
    fss_combined = fss_base.copy()
    mask = (sparks_resized > 120).any(axis=2)
    fss_combined[mask] = cv2.addWeighted(fss_base[mask], 0.3, sparks_resized[mask], 0.7, 0)
    
    print(f"Generating {output_path} ({total_frames} frames @ {fps} FPS)...")
    for idx in range(total_frames):
        sec = idx / fps
        if sec < 5.0:
            base = add_temporal_dynamics(normal_img, idx, w, h)
        elif sec < 10.0:
            base = add_temporal_dynamics(steam_img, idx, w, h)
        elif sec < 15.0:
            base = add_temporal_dynamics(dust_img, idx, w, h)
        elif sec < 20.0:
            base = add_temporal_dynamics(refl_img, idx, w, h)
        elif sec < 25.0:
            base = add_temporal_dynamics(fire_smoke_img, idx, w, h)
        else:
            base = add_temporal_dynamics(fss_combined, idx, w, h)
            
        frame = apply_cctv_osd(base, idx, fps, "CAM-02 LOGISTICS BAY 4")
        out.write(frame)
        
    out.release()
    print(f"Successfully generated {output_path}")

if __name__ == "__main__":
    generate_video_1()
    generate_video_2()

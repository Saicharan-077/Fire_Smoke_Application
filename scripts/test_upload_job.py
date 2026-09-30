import requests
import time
import os

BASE_URL = "http://127.0.0.1:8000"

def main():
    # 1. Login to get token
    login_res = requests.post(f"{BASE_URL}/api/v1/auth/login", json={"username_or_email": "admin@sentinelos.ai", "password": "Admin@123"})
    if login_res.status_code != 200:
        print(f"Login failed: {login_res.text}")
        return
    token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("Logged in successfully. Token acquired.")

    # 2. Upload video
    video_path = r"C:\Users\Sai Charan\Downloads\12773174_3840_2160_24fps.mp4"
    if not os.path.exists(video_path):
        print(f"Video not found: {video_path}")
        return

    print(f"Uploading {os.path.basename(video_path)} for async inference...")
    with open(video_path, "rb") as f:
        upload_res = requests.post(
            f"{BASE_URL}/api/v1/upload/video_async?mode=Real-Time",
            files={"file": (os.path.basename(video_path), f, "video/mp4")},
            headers=headers
        )

    if upload_res.status_code != 200:
        print(f"Upload failed: {upload_res.status_code} {upload_res.text}")
        return

    job_data = upload_res.json()
    job_id = job_data["job_id"]
    print(f"Job started successfully: {job_id}")

    # 3. Poll job status
    start_t = time.time()
    while True:
        status_res = requests.get(f"{BASE_URL}/api/v1/upload/video_job/{job_id}", headers=headers)
        if status_res.status_code != 200:
            print(f"Status poll failed: {status_res.status_code} {status_res.text}")
            break
        
        status = status_res.json()
        pct = status.get("progress_pct", 0)
        curr = status.get("current_frame", 0)
        tot = status.get("total_frames", 0)
        fps = status.get("fps", 0)
        tracks = status.get("active_tracks_count", 0)
        state = status.get("status", "")
        has_dets = status.get("has_detections", False)

        print(f"[{state}] {curr}/{tot} frames ({pct}%) | FPS: {fps:.1f} | Active Tracks: {tracks} | Detections: {has_dets}")

        if state in ("completed", "cancelled", "failed"):
            print("\nJOB FINISHED!")
            print(f"Final Status: {state}")
            print(f"Summary: {status.get('summary')}")
            print(f"Annotated Video: {status.get('annotated_video_path')}")
            print(f"Thumbnail: {status.get('thumbnail_path')}")
            break

        time.sleep(2)

if __name__ == "__main__":
    main()

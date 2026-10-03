import os
import sys
import torch
from ultralytics import YOLO

def inspect_model(model_path: str):
    print("=" * 60, flush=True)
    print("MODEL SPECIFICATION DIAGNOSTICS", flush=True)
    print("=" * 60, flush=True)
    if not os.path.exists(model_path):
        print(f"[ERROR] Model file not found at: {model_path}", flush=True)
        return None

    file_size_bytes = os.path.getsize(model_path)
    file_size_mb = file_size_bytes / (1024 * 1024)
    print(f"MODEL PATH        : {os.path.abspath(model_path)}", flush=True)
    print(f"MODEL FILE SIZE   : {file_size_bytes:,} bytes ({file_size_mb:.2f} MB)", flush=True)

    try:
        ckpt = torch.load(model_path, map_location="cpu", weights_only=False)
        arch = type(ckpt.get("model", "")).__name__ if isinstance(ckpt, dict) else "Unknown"
        train_args = ckpt.get("train_args", {}) if isinstance(ckpt, dict) else {}
        epochs = train_args.get("epochs", "unknown") if isinstance(train_args, dict) else "unknown"
        data_yaml = train_args.get("data", "unknown") if isinstance(train_args, dict) else "unknown"
        imgsz = train_args.get("imgsz", 640) if isinstance(train_args, dict) else 640

        print(f"MODEL ARCHITECTURE: {arch}", flush=True)
        print(f"TRAINING EPOCHS   : {epochs}", flush=True)
        print(f"DATASET PATH      : {data_yaml}", flush=True)
        print(f"CONFIG INPUT SIZE : {imgsz}x{imgsz}", flush=True)
    except Exception as e:
        print(f"[WARNING] Torch checkpoint metadata extraction: {e}", flush=True)

    model = YOLO(model_path)
    names = model.names
    print(f"MODEL CLASS COUNT : {len(names)}", flush=True)
    print(f"MODEL CLASS NAMES :", flush=True)
    for idx, name in names.items():
        print(f"  {idx} = {name}", flush=True)
    print("=" * 60, flush=True)
    return model

if __name__ == "__main__":
    inspect_model("backend/models/best.pt")

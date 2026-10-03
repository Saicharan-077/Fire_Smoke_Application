import os
import sys

PLATFORM_DIR = r"C:\Users\Sai Charan\Desktop\innovision-platform"
LOCAL_DIR = r"c:\Users\Sai Charan\OneDrive\Desktop\Fire_Smoke_Application"

def update_temporal(base_dir):
    temporal_path = os.path.join(base_dir, "services", "uc2_fire_smoke", "src", "detection", "temporal.py")
    if not os.path.exists(temporal_path):
        return
    with open(temporal_path, "r", encoding="utf-8") as f:
        c = f.read()

    old_cls = 'for cls in ("fire", "smoke"):'
    new_cls = 'for cls in ("fire", "smoke", "sparks", "spark"):'
    if old_cls in c:
        c = c.replace(old_cls, new_cls)
        with open(temporal_path, "w", encoding="utf-8") as f:
            f.write(c)
        print(f"[OK] Updated TemporalVerifier in {temporal_path}")
    else:
        print(f"[INFO] TemporalVerifier already handles sparks in {temporal_path}")

def update_engine(base_dir):
    engine_path = os.path.join(base_dir, "services", "uc2_fire_smoke", "src", "detection", "engine.py")
    if not os.path.exists(engine_path):
        return
    with open(engine_path, "r", encoding="utf-8") as f:
        c = f.read()

    # Enhance _load with robust auto device selection and thread tuning
    target_load = '''        try:
            self.device = "cuda" if (torch.cuda.is_available() and settings.device == "cuda") else "cpu"
            self.model = YOLO(path, task="detect")
            self.model.to(self.device)
            self.class_names = self.model.names or {}
            self.ready = True
            logger.info(
                "yolo_loaded device=%s classes=%s half=%s",
                self.device, self.class_names, settings.half_precision,
            )
            self._warmup()'''

    replacement_load = '''        try:
            cuda_avail = torch.cuda.is_available()
            req_dev = str(settings.device).lower()
            if req_dev in ("cuda", "gpu") and cuda_avail:
                self.device = "cuda"
            elif req_dev == "auto":
                self.device = "cuda" if cuda_avail else "cpu"
            else:
                self.device = "cpu"

            if self.device == "cpu":
                # Tune OpenMP thread pool for optimal multi-threaded inference latency
                cpu_threads = min(8, max(2, os.cpu_count() or 4))
                torch.set_num_threads(cpu_threads)

            self.model = YOLO(path, task="detect")
            self.model.to(self.device)
            self.class_names = self.model.names or {}
            self.ready = True
            gpu_name = torch.cuda.get_device_name(0) if cuda_avail else "N/A (No CUDA GPU detected)"
            logger.info(
                "yolo_loaded device=%s cuda_avail=%s gpu_name=%s threads=%d classes=%s half=%s",
                self.device, cuda_avail, gpu_name, torch.get_num_threads(), self.class_names, settings.half_precision,
            )
            self._warmup()'''

    if target_load in c:
        c = c.replace(target_load, replacement_load)
        with open(engine_path, "w", encoding="utf-8") as f:
            f.write(c)
        print(f"[OK] Enhanced YOLO device detection and thread tuning in {engine_path}")
    else:
        print(f"[INFO] Engine already updated or custom in {engine_path}")

    # Enhance get_model_info with hardware diagnostics
    target_info = '''    def get_model_info(self) -> dict:
        return {
            "model_version": settings.model_version,
            "model_path": settings.yolo_model_path,
            "device": self.device,
            "inference_size": settings.inference_size,
            "half_precision": settings.half_precision,
            "ready": self.ready,
            "classes": dict(self.class_names),
        }'''

    replacement_info = '''    def get_model_info(self) -> dict:
        cuda_avail = torch.cuda.is_available()
        return {
            "model_version": settings.model_version,
            "model_path": settings.yolo_model_path,
            "device": self.device,
            "cuda_available": cuda_avail,
            "gpu_name": torch.cuda.get_device_name(0) if cuda_avail else "N/A (No CUDA GPU detected)",
            "pytorch_version": torch.__version__,
            "cpu_threads": torch.get_num_threads(),
            "inference_size": settings.inference_size,
            "half_precision": settings.half_precision,
            "ready": self.ready,
            "classes": dict(self.class_names),
        }'''

    if target_info in c:
        c = c.replace(target_info, replacement_info)
        with open(engine_path, "w", encoding="utf-8") as f:
            f.write(c)
        print(f"[OK] Enhanced get_model_info diagnostics in {engine_path}")

def update_verifier_floodlight(base_dir):
    verif_path = os.path.join(base_dir, "services", "uc2_fire_smoke", "src", "detection", "verifier.py")
    if not os.path.exists(verif_path):
        return
    with open(verif_path, "r", encoding="utf-8") as f:
        c = f.read()

    target_check = '''        # If it's a solid uniform field of high brightness (like sun or bright sky patch)
        if spark_ratio > 0.70 and std_val < 25.0:
            return VerificationResult(
                passed=False,
                rejection_reason=f"broad_light_field (spark_ratio={spark_ratio:.2f})",
                scores=scores,
            )'''

    replacement_check = '''        # If it's a solid uniform field of high brightness (like sun, floodlight bulb, or bright sky patch)
        if spark_ratio > 0.70 and std_val < 25.0:
            return VerificationResult(
                passed=False,
                rejection_reason=f"broad_light_field (spark_ratio={spark_ratio:.2f})",
                scores=scores,
            )

        # Check for static floodlight bulb / large uniform lamp fixture
        num_labels, _labels, stats, _centroids = cv2.connectedComponentsWithStats(spark_mask)
        if num_labels > 1:
            max_component_area = max(stats[1:, cv2.CC_STAT_AREA]) if len(stats) > 1 else 0
            # If a single solid connected component covers > 80% of ROI and has large area, it's a static lamp fixture
            if max_component_area > 2000 and (max_component_area / float(total_px)) > 0.80 and std_val < 30.0:
                return VerificationResult(
                    passed=False,
                    rejection_reason=f"static_floodlight_bulb (comp_area={max_component_area}, ratio={max_component_area/total_px:.2f})",
                    scores=scores,
                )'''

    if target_check in c and "static_floodlight_bulb" not in c:
        c = c.replace(target_check, replacement_check)
        with open(verif_path, "w", encoding="utf-8") as f:
            f.write(c)
        print(f"[OK] Added floodlight bulb rejection to verify_sparks in {verif_path}")
    else:
        print(f"[INFO] Floodlight rejection already present in {verif_path}")

def update_verifier_smoke_rejection(base_dir):
    verif_path = os.path.join(base_dir, "services", "uc2_fire_smoke", "src", "detection", "verifier.py")
    if not os.path.exists(verif_path):
        return
    with open(verif_path, "r", encoding="utf-8") as f:
        c = f.read()

    target_check = "        # Check for static floodlight bulb / large uniform lamp fixture"
    smoke_check = """        # Reject diffuse smoke cloud or overcast daylight patch misclassified as sparks
        if spark_pixels > 0:
            active_spark_hsv = roi_hsv[spark_mask > 0]
            avg_spark_sat = float(np.mean(active_spark_hsv[:, 1]))
            # If bright pixels are desaturated (gray/white smoke or cloud)
            if avg_spark_sat < 55.0 and total_px > 10000:
                return VerificationResult(
                    passed=False,
                    rejection_reason=f"desaturated_smoke_or_cloud (avg_sat={avg_spark_sat:.1f})",
                    scores=scores,
                )

        # Check for static floodlight bulb / large uniform lamp fixture"""

    if "desaturated_smoke_or_cloud" not in c and target_check in c:
        c = c.replace(target_check, smoke_check)
        with open(verif_path, "w", encoding="utf-8") as f:
            f.write(c)
        print(f"[OK] Added desaturated smoke rejection to {verif_path}")
    else:
        print(f"[INFO] Smoke rejection already present or not applicable in {verif_path}")

if __name__ == "__main__":
    for d in [PLATFORM_DIR, LOCAL_DIR]:
        print(f"\n--- Updating {d} ---")
        update_temporal(d)
        update_engine(d)
        update_verifier_floodlight(d)
        update_verifier_smoke_rejection(d)
    print("\n[COMPLETE] All hardening updates applied.")

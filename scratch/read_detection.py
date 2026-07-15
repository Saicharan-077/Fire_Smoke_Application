import os

path = r"c:\Users\Sai Charan\OneDrive\Desktop\Fire_Smoke_Application\frontend\src\pages\Detection.tsx"
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "rtsp" in line.lower() or "cctv" in line.lower() or "function" in line.lower() or "=>" in line:
        if len(line.strip()) < 120 and "const " in line:
            print(f"{i+1}: {line.strip()}")

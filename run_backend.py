import sys
import os

backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Ensure openh264 DLLs in backend and backend/detection are discoverable by OpenCV FFMPEG
detection_dir = os.path.join(backend_dir, 'detection')
for d in (backend_dir, detection_dir):
    if os.path.exists(d):
        os.environ['PATH'] = d + os.path.pathsep + os.environ.get('PATH', '')
        if hasattr(os, 'add_dll_directory'):
            try:
                os.add_dll_directory(d)
            except Exception:
                pass


import uvicorn
from app.main import app

if __name__ == '__main__':
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("app.main:app", host='0.0.0.0', port=port, reload=False)


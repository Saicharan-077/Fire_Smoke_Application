import sys
import os

backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import uvicorn
from app.main import app

if __name__ == '__main__':
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("app.main:app", host='0.0.0.0', port=port, reload=False)


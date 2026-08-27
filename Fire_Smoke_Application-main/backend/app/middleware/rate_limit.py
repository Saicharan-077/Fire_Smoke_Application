"""Simple in-memory rate limiting for auth endpoints."""
import time
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_WINDOW_SECONDS = 60
_MAX_REQUESTS = 30
_buckets: dict[str, list[float]] = defaultdict(list)


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.endswith("/login") or request.url.path.endswith("/register"):
            client = request.client.host if request.client else "unknown"
            now = time.time()
            bucket = _buckets[client]
            _buckets[client] = [t for t in bucket if now - t < _WINDOW_SECONDS]
            if len(_buckets[client]) >= _MAX_REQUESTS:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Please try again later."},
                )
            _buckets[client].append(now)
        return await call_next(request)

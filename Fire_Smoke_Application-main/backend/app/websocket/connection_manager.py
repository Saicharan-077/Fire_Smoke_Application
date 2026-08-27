import json
import logging
from typing import List
from fastapi import WebSocket

logger = logging.getLogger("fireguard.websocket")

class ConnectionManager:
    def __init__(self):
        self._connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.append(ws)
        logger.info(f"[WS] Client connected — total={len(self._connections)}")

    def disconnect(self, ws: WebSocket):
        if ws in self._connections:
            self._connections.remove(ws)
            logger.info(f"[WS] Client disconnected — total={len(self._connections)}")

    async def broadcast(self, payload: dict):
        msg = json.dumps(payload)
        for ws in list(self._connections):
            try:
                await ws.send_text(msg)
            except Exception as e:
                logger.error(f"[WS] Failed to send message: {e}")
                self.disconnect(ws)

manager = ConnectionManager()

"""
UC Helper: Validates AlertEvent and publishes to Redis Stream `alerts:live`.
On validation/serialization failure, routes to `alerts:dead_letter`.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from pydantic import ValidationError
import redis.asyncio as aioredis

from shared.contracts.alert_event import AlertEvent

logger = logging.getLogger("innovision.alert_publisher")


class AlertPublisher:
    """
    Standard AlertPublisher used by all use-case analytics services.
    Publishes to `alerts:live` with fallback to `alerts:dead_letter`.
    """

    def __init__(
        self,
        redis_client: aioredis.Redis,
        live_stream: str = "alerts:live",
        dead_letter_stream: str = "alerts:dead_letter",
        stream_maxlen: int = 10000,
    ) -> None:
        self.redis = redis_client
        self.live_stream = live_stream
        self.dead_letter_stream = dead_letter_stream
        self.stream_maxlen = stream_maxlen

    async def publish(self, event: AlertEvent) -> bool:
        """
        Validate and publish AlertEvent to alerts:live stream.
        Returns True on success, False if routed to dead_letter.
        """
        try:
            # Round-trip JSON validation test
            json_str = event.model_dump_json()
            # Verify valid JSON
            _ = json.loads(json_str)

            # XADD to live stream
            await self.redis.xadd(
                self.live_stream,
                {"data": json_str},
                maxlen=self.stream_maxlen,
                approximate=True,
            )
            logger.info(
                f"Published alert {event.alert_id} for camera {event.camera_id} "
                f"severity={event.severity.value} type={event.alert_type}"
            )
            return True

        except Exception as exc:
            logger.error(f"Failed to publish AlertEvent to {self.live_stream}: {exc}", exc_info=True)
            try:
                raw_payload = str(event) if not isinstance(event, str) else event
                await self.redis.xadd(
                    self.dead_letter_stream,
                    {
                        "error": str(exc),
                        "raw_data": raw_payload,
                    },
                    maxlen=self.stream_maxlen,
                    approximate=True,
                )
            except Exception as dl_err:
                logger.critical(f"Failed to write to dead_letter stream: {dl_err}")
            return False

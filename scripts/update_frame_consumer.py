import os

PLATFORM_DIR = r"C:\Users\Sai Charan\Desktop\innovision-platform"
path = os.path.join(PLATFORM_DIR, "services", "uc2_fire_smoke", "src", "redis", "frame_consumer.py")

with open(path, "r", encoding="utf-8") as f:
    c = f.read()

target = '''    async def read_frames(
        self,
        batch_size: int = 1,
        block_ms: int = 1000,
    ) -> AsyncGenerator[Tuple[str, FrameEvent, Optional[np.ndarray]], None]:
        """
        Generator yielding (message_id, FrameEvent, frame_bgr_image).
        """
        await self.ensure_consumer_group()

        try:
            entries = await self.redis.xreadgroup(
                groupname=self.group_name,
                consumername=self.consumer_name,
                streams={self.stream_key: ">"},
                count=batch_size,
                block=block_ms,
            )

            if not entries:
                return

            for stream, messages in entries:
                for msg_id, fields in messages:'''

replacement = '''    async def read_frames(
        self,
        batch_size: int = 1,
        block_ms: int = 1000,
        latest_only: bool = True,
    ) -> AsyncGenerator[Tuple[str, FrameEvent, Optional[np.ndarray]], None]:
        """
        Generator yielding (message_id, FrameEvent, frame_bgr_image).
        When latest_only=True and a backlog of frames has accumulated in Redis,
        intermediate stale frames are acknowledged to prevent unbounded queue growth
        and ensure strict frame freshness for real-time detection.
        """
        await self.ensure_consumer_group()

        try:
            entries = await self.redis.xreadgroup(
                groupname=self.group_name,
                consumername=self.consumer_name,
                streams={self.stream_key: ">"},
                count=batch_size,
                block=block_ms,
            )

            if not entries:
                return

            for stream, messages in entries:
                if not messages:
                    continue

                if latest_only and len(messages) > 1:
                    for s_id, _ in messages[:-1]:
                        s_str = s_id.decode("utf-8") if isinstance(s_id, bytes) else str(s_id)
                        await self.ack(s_str)
                    messages = [messages[-1]]

                for msg_id, fields in messages:'''

if target in c:
    c = c.replace(target, replacement)
    with open(path, "w", encoding="utf-8") as f:
        f.write(c)
    print("[OK] Updated frame_consumer.py with latest_only queue bounded optimization")
else:
    print("[WARN] Target not found in frame_consumer.py")

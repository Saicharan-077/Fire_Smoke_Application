"""
Multi-camera priority queue (Master Pipeline Document, Section 8).

The Gate runs continuously on EVERY camera because it is nearly free. Only a
camera whose Gate signals activity is promoted into this queue, which feeds the
expensive, shared Model stage. Compute is therefore spent only where something
is actually happening.

Priority ordering, highest first:

    1. Active/unresolved alert already on that camera
         -- needs continuous processing to track fire growth, and must not be
            starved by a new low-priority trigger elsewhere
    2. Zone risk weight
         -- a chemical store bumps ahead of a break area
    3. Recency/strength of the gate signal
         -- stronger motion suggests more urgency
    4. Round-robin fallback
         -- guarantees no camera is starved indefinitely under sustained load

Rule 4 is not a tie-breaker bolted onto rules 1-3; it is a genuine
anti-starvation mechanism. A camera that has been waiting long enough is
promoted above its natural priority, so a permanently-busy high-risk camera
cannot silently blind every other camera on the site.
"""

from __future__ import annotations

import heapq
import itertools
import threading
import time
from dataclasses import dataclass, field

from ..contracts import GateResult, TriggerReason


# A camera waiting longer than this is escalated regardless of its own
# priority, so sustained load cannot starve it.
DEFAULT_STARVATION_S = 8.0


@dataclass(slots=True)
class QueuedFrame:
    """One Gate-approved frame awaiting the Model stage."""

    gate_result: GateResult
    enqueued_monotonic: float
    has_active_alert: bool
    zone_risk_weight: float | None
    source_type: str = "stream"

    @property
    def camera_id(self) -> str:
        return self.gate_result.camera_id

    @property
    def change_score(self) -> float:
        return self.gate_result.change_score

    @property
    def forced(self) -> bool:
        return self.gate_result.trigger_reason is TriggerReason.FORCED_OVERRIDE

    def age_s(self, now: float | None = None) -> float:
        return (now if now is not None else time.monotonic()) - self.enqueued_monotonic


def priority_key(
    item: QueuedFrame, now: float, starvation_s: float = DEFAULT_STARVATION_S
) -> tuple:
    """Ordering key. Lower sorts first (heapq is a min-heap).

    Each component is negated where "more" should mean "sooner", so the tuple
    reads in the same order as the documented priority list.
    """
    age = item.age_s(now)
    starving = age >= starvation_s

    # An uncalibrated camera has no risk weight. Treat it as mid-risk rather
    # than lowest -- an unknown zone is not a safe zone.
    risk = 0.6 if item.zone_risk_weight is None else item.zone_risk_weight

    return (
        0 if starving else 1,               # 4. starvation escape hatch, first
        0 if item.has_active_alert else 1,  # 1. active alert on this camera
        -risk,                              # 2. zone risk weight
        -item.change_score,                 # 3. gate signal strength
        -age,                               # older before newer within a band
    )


class PriorityFrameQueue:
    """Thread-safe priority queue with one slot per camera.

    Only the FRESHEST frame per camera is retained. A camera that keeps
    triggering while the Model is busy must not accumulate a backlog of stale
    frames -- the same drop-oldest discipline the live-stream path uses, applied
    across cameras instead of within one.
    """

    def __init__(self, starvation_s: float = DEFAULT_STARVATION_S):
        self._starvation_s = starvation_s
        self._lock = threading.Lock()
        self._not_empty = threading.Condition(self._lock)
        self._pending: dict[str, QueuedFrame] = {}
        self._counter = itertools.count()
        # Observability -- never fabricated.
        self.enqueued_total = 0
        self.superseded_total = 0
        self.dequeued_total = 0
        self.starvation_promotions = 0
        self._max_depth = 0

    def put(self, item: QueuedFrame) -> bool:
        """Enqueue a frame. Returns True if it replaced a stale one."""
        with self._not_empty:
            replaced = item.camera_id in self._pending
            if replaced:
                self.superseded_total += 1
            self._pending[item.camera_id] = item
            self.enqueued_total += 1
            self._max_depth = max(self._max_depth, len(self._pending))
            self._not_empty.notify()
            return replaced

    def get(self, timeout: float | None = 0.5) -> QueuedFrame | None:
        """Pop the highest-priority frame, or None if none arrives in time."""
        with self._not_empty:
            if not self._pending:
                if not self._not_empty.wait(timeout=timeout):
                    return None
                if not self._pending:
                    return None
            now = time.monotonic()
            best_id = min(
                self._pending,
                key=lambda cid: priority_key(self._pending[cid], now, self._starvation_s),
            )
            item = self._pending.pop(best_id)
            self.dequeued_total += 1
            if item.age_s(now) >= self._starvation_s:
                self.starvation_promotions += 1
            return item

    def snapshot(self) -> list[QueuedFrame]:
        """Current contents in priority order. For telemetry and tests."""
        with self._lock:
            now = time.monotonic()
            return sorted(
                self._pending.values(),
                key=lambda i: priority_key(i, now, self._starvation_s),
            )

    def depth(self) -> int:
        with self._lock:
            return len(self._pending)

    def stats(self) -> dict:
        with self._lock:
            return {
                "depth": len(self._pending),
                "max_depth": self._max_depth,
                "enqueued_total": self.enqueued_total,
                "superseded_total": self.superseded_total,
                "dequeued_total": self.dequeued_total,
                "starvation_promotions": self.starvation_promotions,
                "starvation_threshold_s": self._starvation_s,
            }

    def clear(self) -> None:
        with self._lock:
            self._pending.clear()

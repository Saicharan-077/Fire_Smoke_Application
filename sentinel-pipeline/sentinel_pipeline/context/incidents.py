"""
Multi-camera incident resolution — same fire vs. different fires.

Uses the calibration-derived adjacency map plus a time window, rather than 3D
triangulation:

  * detections in the SAME zone, or in zones flagged ADJACENT/OVERLAPPING,
    within a short window -> ONE incident with multiple camera evidence
    sources attached;
  * detections with NO defined overlap -> FULLY INDEPENDENT incidents, each
    tracked and alerted separately. One must never mask or delay the other.

That last property is the safety-critical one, so the default when adjacency is
unknown is "separate incident" -- merging two real fires into one would hide
the second.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field

from ..config import ContextSettings, settings as global_settings
from ..contracts import Severity, ThreatClass, utc_now
from .zones import ZoneRegistry

logger = logging.getLogger("sentinel.incidents")


@dataclass(slots=True)
class IncidentSource:
    camera_id: str
    track_id: int
    zone_id: str | None
    first_seen_monotonic: float
    last_seen_monotonic: float
    alert_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Incident:
    incident_id: str
    threat_class: ThreatClass
    severity: Severity
    created_at: object
    first_seen_monotonic: float
    last_seen_monotonic: float
    sources: dict[str, IncidentSource] = field(default_factory=dict)
    peak_score: float = 0.0
    resolved: bool = False

    @property
    def camera_ids(self) -> list[str]:
        return list(self.sources.keys())

    @property
    def is_multi_camera(self) -> bool:
        return len(self.sources) > 1

    def as_dict(self) -> dict:
        return {
            "incident_id": self.incident_id,
            "threat_class": self.threat_class.value,
            "severity": self.severity.value,
            "created_at": self.created_at.isoformat() if hasattr(self.created_at, "isoformat") else str(self.created_at),
            "peak_score": round(self.peak_score, 4),
            "resolved": self.resolved,
            "camera_ids": self.camera_ids,
            "is_multi_camera": self.is_multi_camera,
            "sources": [
                {
                    "camera_id": s.camera_id,
                    "track_id": s.track_id,
                    "zone_id": s.zone_id,
                    "alert_ids": list(s.alert_ids),
                }
                for s in self.sources.values()
            ],
        }


class IncidentResolver:
    """Correlates detections across cameras into incidents."""

    def __init__(self, zones: ZoneRegistry, cfg: ContextSettings | None = None):
        self._zones = zones
        self._cfg = cfg or global_settings.context
        self._incidents: dict[str, Incident] = {}

    def _expire(self, now_monotonic: float) -> None:
        window = self._cfg.incident_correlation_window_s
        for inc in self._incidents.values():
            if not inc.resolved and (now_monotonic - inc.last_seen_monotonic) > window * 3:
                inc.resolved = True
                logger.info(
                    "[Incident] %s auto-closed after %.0fs without activity",
                    inc.incident_id, now_monotonic - inc.last_seen_monotonic,
                )

    def _same_class_family(self, a: ThreatClass, b: ThreatClass) -> bool:
        """Smoke of differing colour from one fire is still one fire."""
        if a is b:
            return True
        return a.is_smoke and b.is_smoke

    def resolve(
        self,
        *,
        camera_id: str,
        track_id: int,
        threat_class: ThreatClass,
        severity: Severity,
        score: float,
        monotonic_ts: float | None = None,
    ) -> tuple[Incident, bool]:
        """Attach this detection to an existing incident, or open a new one.

        Returns ``(incident, is_new)``.
        """
        now = monotonic_ts if monotonic_ts is not None else time.monotonic()
        self._expire(now)

        zone = self._zones.get_for_camera(camera_id)
        zone_id = zone.zone_id if zone else None
        window = self._cfg.incident_correlation_window_s

        for inc in self._incidents.values():
            if inc.resolved:
                continue
            if (now - inc.last_seen_monotonic) > window:
                continue
            if not self._same_class_family(inc.threat_class, threat_class):
                continue

            # Same camera + same track is unambiguously the same incident.
            existing = inc.sources.get(camera_id)
            if existing is not None and existing.track_id == track_id:
                self._touch(inc, camera_id, track_id, zone_id, now, severity, score)
                return inc, False

            # Different camera: merge only if adjacency is explicitly known.
            if any(
                self._zones.are_adjacent(camera_id, other)
                for other in inc.sources
                if other != camera_id
            ):
                self._touch(inc, camera_id, track_id, zone_id, now, severity, score)
                logger.info(
                    "[Incident] %s now corroborated by camera=%s (adjacency) -- "
                    "same fire, %d camera source(s)",
                    inc.incident_id, camera_id, len(inc.sources),
                )
                return inc, False

            if existing is not None:
                self._touch(inc, camera_id, track_id, zone_id, now, severity, score)
                return inc, False

        # No overlap established -> an independent incident. Deliberately the
        # default: merging two unrelated fires would mask one of them.
        inc = Incident(
            incident_id=f"inc_{uuid.uuid4().hex[:12]}",
            threat_class=threat_class,
            severity=severity,
            created_at=utc_now(),
            first_seen_monotonic=now,
            last_seen_monotonic=now,
            peak_score=score,
        )
        inc.sources[camera_id] = IncidentSource(
            camera_id=camera_id, track_id=track_id, zone_id=zone_id,
            first_seen_monotonic=now, last_seen_monotonic=now,
        )
        self._incidents[inc.incident_id] = inc
        logger.info(
            "[Incident] opened %s class=%s severity=%s camera=%s",
            inc.incident_id, threat_class.value, severity.value, camera_id,
        )
        return inc, True

    @staticmethod
    def _touch(
        inc: Incident, camera_id: str, track_id: int, zone_id: str | None,
        now: float, severity: Severity, score: float,
    ) -> None:
        src = inc.sources.get(camera_id)
        if src is None:
            inc.sources[camera_id] = IncidentSource(
                camera_id=camera_id, track_id=track_id, zone_id=zone_id,
                first_seen_monotonic=now, last_seen_monotonic=now,
            )
        else:
            src.last_seen_monotonic = now
            src.track_id = track_id
        inc.last_seen_monotonic = now
        if score > inc.peak_score:
            inc.peak_score = score
            inc.severity = severity

    def get(self, incident_id: str) -> Incident | None:
        return self._incidents.get(incident_id)

    def active(self) -> list[Incident]:
        return [i for i in self._incidents.values() if not i.resolved]

    def all(self) -> list[Incident]:
        return list(self._incidents.values())

"""
Zone / containment data model — owned by the pipeline, not the dashboard.

Implements the generalised containment pattern from the Master Pipeline
Document Section 6: rather than separate logic per scenario (furnace vs flare
vs chimney vs bonfire), every zone is defined by

  1. a containment boundary -- where fire/smoke is EXPECTED for this zone; and
  2. a normal envelope -- expected size range, and whether the source is
     always-on (furnace, flare, chimney) or occasional (bonfire).

Two universal runtime checks then apply regardless of what is producing the
fire, which is what keeps this from needing new code per scenario.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace

import cv2
import numpy as np

from ..contracts import BBox


@dataclass(frozen=True, slots=True)
class NormalEnvelope:
    """Expected behaviour of a legitimate source in this zone.

    Populated by Calibration Mode from observed detections, or set manually.
    ``None`` fields mean "no expectation recorded" and never trigger an alert
    on their own.
    """

    min_area: int | None = None
    max_area: int | None = None
    mean_area: float | None = None
    std_area: float | None = None
    always_on: bool = False
    # How many standard deviations above mean_area counts as abnormal.
    area_sigma_tolerance: float = 3.0

    def area_is_normal(self, area: int) -> tuple[bool, str]:
        if self.max_area is not None and area > self.max_area:
            if self.mean_area is not None and self.std_area:
                limit = self.mean_area + self.area_sigma_tolerance * self.std_area
                if area > limit:
                    return False, f"area {area} exceeds mean+{self.area_sigma_tolerance}sigma ({limit:.0f})"
                return True, "within statistical envelope"
            return False, f"area {area} exceeds observed max {self.max_area}"
        return True, "within envelope"

    def as_dict(self) -> dict:
        return {
            "min_area": self.min_area,
            "max_area": self.max_area,
            "mean_area": self.mean_area,
            "std_area": self.std_area,
            "always_on": self.always_on,
            "area_sigma_tolerance": self.area_sigma_tolerance,
        }


@dataclass(frozen=True, slots=True)
class Zone:
    """A configured zone for one camera."""

    zone_id: str
    camera_id: str
    name: str = ""
    # Containment polygon in full-frame pixel coordinates: [(x, y), ...].
    # Empty means NO containment defined -> every detection is a breach, which
    # is the correct default for an unconfigured camera.
    polygon: tuple[tuple[int, int], ...] = ()
    risk_weight: float = 0.5
    flammable_materials_nearby: bool = False
    designated_activity_allowed: tuple[str, ...] = ()
    envelope: NormalEnvelope = field(default_factory=NormalEnvelope)
    approved: bool = False
    # Cameras whose fields of view overlap this one. Used for same-fire
    # deduplication across cameras.
    adjacent_camera_ids: tuple[str, ...] = ()

    @property
    def has_containment(self) -> bool:
        return len(self.polygon) >= 3

    @property
    def risk_tier(self) -> str:
        if self.risk_weight >= 0.8:
            return "high"
        if self.risk_weight >= 0.4:
            return "medium"
        return "low"

    def contains(self, bbox: BBox) -> tuple[bool, float]:
        """Is the detection inside the containment boundary?

        Returns ``(inside, containment_fraction)``. A detection is treated as
        contained when the majority of its box footprint falls inside the
        polygon -- testing the centroid alone would call a fire "contained"
        while most of it has already spread outside the boundary.
        """
        if not self.has_containment:
            return False, 0.0

        poly = np.array(self.polygon, dtype=np.int32)

        # Sample the box on a grid and measure what fraction lands inside.
        xs = np.linspace(bbox.x1, bbox.x2, 5)
        ys = np.linspace(bbox.y1, bbox.y2, 5)
        inside_count = 0
        total = 0
        for x in xs:
            for y in ys:
                total += 1
                if cv2.pointPolygonTest(poly, (float(x), float(y)), False) >= 0:
                    inside_count += 1

        fraction = inside_count / total if total else 0.0
        return fraction >= 0.5, fraction

    def allows_activity(self, activity: str) -> bool:
        return activity in self.designated_activity_allowed

    def as_dict(self) -> dict:
        return {
            "zone_id": self.zone_id,
            "camera_id": self.camera_id,
            "name": self.name,
            "polygon": [list(p) for p in self.polygon],
            "risk_weight": self.risk_weight,
            "risk_tier": self.risk_tier,
            "flammable_materials_nearby": self.flammable_materials_nearby,
            "designated_activity_allowed": list(self.designated_activity_allowed),
            "envelope": self.envelope.as_dict(),
            "approved": self.approved,
            "adjacent_camera_ids": list(self.adjacent_camera_ids),
            "has_containment": self.has_containment,
        }

    @staticmethod
    def from_dict(d: dict) -> "Zone":
        env = d.get("envelope") or {}
        return Zone(
            zone_id=d["zone_id"],
            camera_id=d["camera_id"],
            name=d.get("name", ""),
            polygon=tuple(tuple(int(v) for v in p) for p in d.get("polygon", ())),
            risk_weight=float(d.get("risk_weight", 0.5)),
            flammable_materials_nearby=bool(d.get("flammable_materials_nearby", False)),
            designated_activity_allowed=tuple(d.get("designated_activity_allowed", ())),
            envelope=NormalEnvelope(
                min_area=env.get("min_area"),
                max_area=env.get("max_area"),
                mean_area=env.get("mean_area"),
                std_area=env.get("std_area"),
                always_on=bool(env.get("always_on", False)),
                area_sigma_tolerance=float(env.get("area_sigma_tolerance", 3.0)),
            ),
            approved=bool(d.get("approved", False)),
            adjacent_camera_ids=tuple(d.get("adjacent_camera_ids", ())),
        )


class ZoneRegistry:
    """In-memory zone store, persisted through the pipeline's own database."""

    def __init__(self) -> None:
        self._by_camera: dict[str, Zone] = {}

    def set(self, zone: Zone) -> Zone:
        self._by_camera[zone.camera_id] = zone
        return zone

    def get_for_camera(self, camera_id: str) -> Zone | None:
        return self._by_camera.get(camera_id)

    def risk_weight_for(self, camera_id: str) -> float | None:
        z = self._by_camera.get(camera_id)
        # An unapproved zone must not yet influence risk-tier behaviour.
        return z.risk_weight if (z and z.approved) else None

    def remove(self, camera_id: str) -> None:
        self._by_camera.pop(camera_id, None)

    def all(self) -> list[Zone]:
        return list(self._by_camera.values())

    def by_camera(self) -> dict[str, Zone]:
        return dict(self._by_camera)

    def are_adjacent(self, camera_a: str, camera_b: str) -> bool:
        if camera_a == camera_b:
            return True
        za = self._by_camera.get(camera_a)
        zb = self._by_camera.get(camera_b)
        if za and camera_b in za.adjacent_camera_ids:
            return True
        if zb and camera_a in zb.adjacent_camera_ids:
            return True
        # Same zone id across two cameras also implies the same physical space.
        if za and zb and za.zone_id == zb.zone_id:
            return True
        return False

    def to_json(self) -> str:
        return json.dumps([z.as_dict() for z in self.all()], indent=2)

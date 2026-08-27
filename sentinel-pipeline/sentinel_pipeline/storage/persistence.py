"""
Persistence for zone config and calibration observations.

Both were previously in-memory only, so a restart silently discarded an
approved zone -- and with it the camera's risk tier, containment boundary and
normal envelope. That matters as soon as this runs anywhere real: the pipeline
would come back up treating a calibrated furnace as an uncalibrated camera.

The pipeline owns these tables. Nothing outside the pipeline reads them.
"""

from __future__ import annotations

import json
import logging

from ..context.calibration import CalibrationObservation
from ..context.zones import NormalEnvelope, Zone
from ..contracts import BBox, utc_now
from .alerts import AlertStore
from .models import CalibrationRecord, ZoneRecord

logger = logging.getLogger("sentinel.persistence")


class ZonePersistence:
    def __init__(self, store: AlertStore):
        self._store = store

    def save(self, zone: Zone) -> None:
        with self._store.session() as s:
            rec = (
                s.query(ZoneRecord)
                .filter(ZoneRecord.camera_id == zone.camera_id)
                .first()
            )
            if rec is None:
                rec = ZoneRecord(camera_id=zone.camera_id)
                s.add(rec)
            rec.zone_id = zone.zone_id
            rec.name = zone.name
            rec.polygon_json = json.dumps([list(p) for p in zone.polygon])
            rec.risk_weight = zone.risk_weight
            rec.flammable_materials_nearby = zone.flammable_materials_nearby
            rec.designated_activity_json = json.dumps(list(zone.designated_activity_allowed))
            rec.envelope_json = json.dumps(zone.envelope.as_dict())
            rec.adjacent_cameras_json = json.dumps(list(zone.adjacent_camera_ids))
            rec.approved = zone.approved
            s.commit()
        logger.info("[Persistence] saved zone camera=%s zone=%s", zone.camera_id, zone.zone_id)

    def load_all(self) -> list[Zone]:
        out: list[Zone] = []
        with self._store.session() as s:
            for r in s.query(ZoneRecord).all():
                env = json.loads(r.envelope_json or "{}")
                out.append(Zone(
                    zone_id=r.zone_id,
                    camera_id=r.camera_id,
                    name=r.name or "",
                    polygon=tuple(tuple(int(v) for v in p)
                                  for p in json.loads(r.polygon_json or "[]")),
                    risk_weight=float(r.risk_weight),
                    flammable_materials_nearby=bool(r.flammable_materials_nearby),
                    designated_activity_allowed=tuple(
                        json.loads(r.designated_activity_json or "[]")),
                    envelope=NormalEnvelope(
                        min_area=env.get("min_area"),
                        max_area=env.get("max_area"),
                        mean_area=env.get("mean_area"),
                        std_area=env.get("std_area"),
                        always_on=bool(env.get("always_on", False)),
                        area_sigma_tolerance=float(env.get("area_sigma_tolerance", 3.0)),
                    ),
                    approved=bool(r.approved),
                    adjacent_camera_ids=tuple(json.loads(r.adjacent_cameras_json or "[]")),
                ))
        return out

    def delete(self, camera_id: str) -> None:
        with self._store.session() as s:
            for r in s.query(ZoneRecord).filter(ZoneRecord.camera_id == camera_id).all():
                s.delete(r)
            s.commit()


class CalibrationPersistence:
    def __init__(self, store: AlertStore):
        self._store = store

    def record(
        self, camera_id: str, bbox: BBox, threat_class: str, confidence: float
    ) -> None:
        with self._store.session() as s:
            s.add(CalibrationRecord(
                camera_id=camera_id,
                bbox_x1=bbox.x1, bbox_y1=bbox.y1, bbox_x2=bbox.x2, bbox_y2=bbox.y2,
                threat_class=threat_class, confidence=float(confidence),
                timestamp=utc_now(),
            ))
            s.commit()

    def load_for(self, camera_id: str) -> list[CalibrationObservation]:
        out: list[CalibrationObservation] = []
        with self._store.session() as s:
            rows = (
                s.query(CalibrationRecord)
                .filter(CalibrationRecord.camera_id == camera_id)
                .order_by(CalibrationRecord.timestamp)
                .all()
            )
            base = None
            for i, r in enumerate(rows):
                ts = r.timestamp
                if base is None:
                    base = ts
                # Reconstruct a monotonic-like ordering from wall timestamps.
                # Exact monotonic values cannot survive a restart; relative
                # spacing is what the clustering and always-on checks use.
                offset = (ts - base).total_seconds() if ts and base else float(i)
                out.append(CalibrationObservation(
                    timestamp=ts, monotonic_ts=offset,
                    bbox=BBox(r.bbox_x1, r.bbox_y1, r.bbox_x2, r.bbox_y2),
                    threat_class=r.threat_class, confidence=r.confidence,
                ))
        return out

    def camera_ids(self) -> list[str]:
        with self._store.session() as s:
            return [
                r[0] for r in s.query(CalibrationRecord.camera_id).distinct().all()
            ]

    def clear(self, camera_id: str) -> None:
        with self._store.session() as s:
            for r in (s.query(CalibrationRecord)
                      .filter(CalibrationRecord.camera_id == camera_id).all()):
                s.delete(r)
            s.commit()

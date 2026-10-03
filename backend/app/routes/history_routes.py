"""History routes — /api/v1/history

Provides paginated incident history and export endpoints.

History rows are sourced from the existing Alerts table (models.Alert).
"""

import csv
import io
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from ..database import get_db
from ..routes.auth_routes import get_current_user
from .. import models

router = APIRouter(prefix="/api/v1/history", tags=["history"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.history")


def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    if not date_str:
        return None
    # Expect YYYY-MM-DD
    try:
        return datetime.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {date_str}. Expected YYYY-MM-DD")


def _apply_common_filters(
    q,
    *,
    search: Optional[str],
    status: Optional[str],
    alert_type: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
):
    if status:
        q = q.filter(models.Alert.status == status)

    if alert_type:
        q = q.filter(models.Alert.detection_type == alert_type)

    if search:
        term = f"%{search}%"
        q = q.filter(
            or_(
                models.Alert.id.ilike(term),
                models.Alert.file_name.ilike(term),
                models.Alert.location.ilike(term),
                models.Alert.camera_id.ilike(term),
                models.Alert.source_type.ilike(term),
            )
        )

    sd = _parse_date(start_date)
    ed = _parse_date(end_date)

    if sd:
        q = q.filter(models.Alert.timestamp >= sd)
    if ed:
        # include the whole end day
        q = q.filter(models.Alert.timestamp <= (ed.replace(hour=23, minute=59, second=59, microsecond=999999)))

    return q


@router.get("", response_model=dict)
def get_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None, regex="^(fire|smoke|sparks)$"),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Alert)
    q = _apply_common_filters(
        q,
        search=search,
        status=status,
        alert_type=type,
        start_date=start_date,
        end_date=end_date,
    )

    total = q.count()
    pages = max(1, (total + page_size - 1) // page_size)

    if page > pages:
        page = pages

    items = (
        q.order_by(models.Alert.timestamp.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    # Shape matches frontend HistoryItem.
    return {
        "items": [
            {
                "id": a.id,
                "detection_type": a.detection_type,
                "confidence": a.confidence,
                "status": a.status,
                "source_type": a.source_type,
                "camera_id": a.camera_id,
                "location": a.location,
                "file_name": a.file_name,
                "evidence_path": a.evidence_path,
                "frame_number": a.frame_number,
                "timestamp": (a.timestamp.isoformat() + "Z") if a.timestamp and not a.timestamp.isoformat().endswith("Z") else (a.timestamp.isoformat() if a.timestamp else ""),
            }
            for a in items
        ],
        "total": total,
        "page": page,
        "limit": page_size,
        "total_pages": pages,
    }


@router.get("/export/csv")
def export_history_csv(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None, regex="^(fire|smoke|sparks)$"),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Alert)
    q = _apply_common_filters(
        q,
        search=search,
        status=status,
        alert_type=type,
        start_date=start_date,
        end_date=end_date,
    )

    alerts: List[models.Alert] = q.order_by(models.Alert.timestamp.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "detection_type",
            "confidence",
            "status",
            "source_type",
            "camera_id",
            "location",
            "file_name",
            "evidence_path",
            "frame_number",
            "timestamp",
        ]
    )

    for a in alerts:
        writer.writerow(
            [
                a.id,
                a.detection_type,
                a.confidence,
                a.status,
                a.source_type,
                a.camera_id,
                a.location,
                a.file_name,
                a.evidence_path,
                a.frame_number,
                a.timestamp.isoformat(),
            ]
        )

    csv_bytes = output.getvalue().encode("utf-8")
    headers = {
        "Content-Disposition": "attachment; filename=history.csv",
        "Content-Type": "text/csv; charset=utf-8",
    }
    return Response(content=csv_bytes, headers=headers)


@router.get("/export/pdf")
def export_history_pdf(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None, regex="^(fire|smoke|sparks)$"),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    # Keep dependencies minimal: generate a simple PDF using reportlab.
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail="PDF export requires 'reportlab' dependency. Install backend dependency to enable this endpoint.",
        )

    q = db.query(models.Alert)
    q = _apply_common_filters(
        q,
        search=search,
        status=status,
        alert_type=type,
        start_date=start_date,
        end_date=end_date,
    )

    alerts: List[models.Alert] = q.order_by(models.Alert.timestamp.desc()).all()

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    y = height - 50
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, "SentinelOS — History Export")
    y -= 20
    c.setFont("Helvetica", 8)

    headers = [
        "ID",
        "Type",
        "Conf",
        "Status",
        "Location/Camera",
        "Time",
    ]

    line = " | ".join(headers)
    c.drawString(50, y, line[:90])
    y -= 12

    for a in alerts[:5000]:  # safety cap
        if y < 40:
            c.showPage()
            y = height - 50
            c.setFont("Helvetica", 8)

        loc = a.location or a.camera_id or "Unknown"
        row = f"{a.id[:8]} | {a.detection_type} | {a.confidence:.2f} | {a.status} | {loc[:20]} | {a.timestamp.strftime('%Y-%m-%d %H:%M')}"
        c.drawString(50, y, row[:110])
        y -= 10

    c.showPage()
    c.save()

    pdf_bytes = buffer.getvalue()
    headers_resp = {
        "Content-Disposition": "attachment; filename=history.pdf",
        "Content-Type": "application/pdf",
    }
    return Response(content=pdf_bytes, headers=headers_resp)


@router.get("/export/json")
def export_history_json(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None, regex="^(fire|smoke|sparks)$"),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    import json
    q = db.query(models.Alert)
    q = _apply_common_filters(
        q,
        search=search,
        status=status,
        alert_type=type,
        start_date=start_date,
        end_date=end_date,
    )

    alerts: List[models.Alert] = q.order_by(models.Alert.timestamp.desc()).all()
    records = [
        {
            "id": a.id,
            "detection_type": a.detection_type,
            "confidence": a.confidence,
            "status": a.status,
            "source_type": a.source_type,
            "camera_id": a.camera_id,
            "location": a.location,
            "file_name": a.file_name,
            "evidence_path": a.evidence_path,
            "frame_number": a.frame_number,
            "timestamp": (a.timestamp.isoformat() + "Z") if a.timestamp and not a.timestamp.isoformat().endswith("Z") else (a.timestamp.isoformat() if a.timestamp else ""),
        }
        for a in alerts
    ]
    json_bytes = json.dumps(records, indent=2).encode("utf-8")
    headers = {
        "Content-Disposition": "attachment; filename=history.json",
        "Content-Type": "application/json",
    }
    return Response(content=json_bytes, headers=headers)



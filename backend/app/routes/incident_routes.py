"""
Incident routes — /api/v1/incidents and /incidents
"""
import logging
import math
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List
from datetime import datetime

from ..database import get_db
from ..routes.auth_routes import get_current_user, log_audit, log_system
from .. import models, schemas

router = APIRouter(prefix="/api/v1/incidents", tags=["incidents"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.incidents")


@router.get("", response_model=dict)
def list_incidents(
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(models.Incident)
    if status:
        q = q.filter(models.Incident.status == status)
    if severity:
        q = q.filter(models.Incident.severity == severity)
    if search:
        term = f"%{search}%"
        q = q.filter(
            or_(
                models.Incident.title.ilike(term),
                models.Incident.description.ilike(term),
                models.Incident.reporter.ilike(term),
                models.Incident.assigned_user.ilike(term),
            )
        )

    total = q.count()
    pages = max(1, math.ceil(total / limit))
    items = (
        q.order_by(models.Incident.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    }


@router.post("", response_model=schemas.IncidentOut)
def create_incident(
    body: schemas.IncidentCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Check if alert_id exists if supplied
    if body.alert_id:
        alert = db.query(models.Alert).filter(models.Alert.id == body.alert_id).first()
        if not alert:
            raise HTTPException(status_code=404, detail="Associated Alert not found")

    new_incident = models.Incident(
        title=body.title,
        description=body.description,
        severity=body.severity or "medium",
        status=body.status or "active",
        alert_id=body.alert_id,
        reporter=body.reporter or current_user.username,
        assigned_user=body.assigned_user,
        notes=body.notes,
    )
    db.add(new_incident)
    db.commit()
    db.refresh(new_incident)

    log_audit(db, current_user, "INCIDENT_CREATE", f"Created incident: {new_incident.title} (ID: {new_incident.id})")
    log_system(db, "INFO", "incidents", f"Incident ticket generated: {new_incident.title}")

    return new_incident


@router.get("/export/pdf")
def export_incidents_pdf(
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
    except Exception:
        raise HTTPException(status_code=500, detail="reportlab not installed")

    q = db.query(models.Incident)
    if status:
        q = q.filter(models.Incident.status == status)
    if severity:
        q = q.filter(models.Incident.severity == severity)
        
    incidents = q.order_by(models.Incident.created_at.desc()).all()
    
    import io
    from fastapi import Response
    
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    
    y = height - 50
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, y, "FireGuard AI — Incident Tickets Export")
    y -= 30
    
    c.setFont("Helvetica-Bold", 8)
    headers = "ID       | Severity | Status   | Title                              | Created"
    c.drawString(50, y, headers)
    y -= 15
    c.setFont("Helvetica", 8)
    
    for inc in incidents[:1000]:
        if y < 40:
            c.showPage()
            y = height - 50
            c.setFont("Helvetica", 8)
        
        row = f"{inc.id[:8]} | {inc.severity:<8} | {inc.status:<8} | {inc.title[:32]:<34} | {inc.created_at.strftime('%Y-%m-%d %H:%M')}"
        c.drawString(50, y, row)
        y -= 12
        
    c.showPage()
    c.save()
    
    pdf_bytes = buffer.getvalue()
    headers_resp = {
        "Content-Disposition": "attachment; filename=incidents_report.pdf",
        "Content-Type": "application/pdf",
    }
    return Response(content=pdf_bytes, headers=headers_resp)


@router.get("/{incident_id}", response_model=schemas.IncidentOut)
def get_incident(incident_id: str, db: Session = Depends(get_db)):
    incident = db.query(models.Incident).filter(models.Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.patch("/{incident_id}", response_model=schemas.IncidentOut)
def update_incident(
    incident_id: str,
    body: schemas.IncidentUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    incident = db.query(models.Incident).filter(models.Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(incident, field, value)

    incident.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(incident)

    log_audit(db, current_user, "INCIDENT_UPDATE", f"Updated incident ID: {incident_id} (Status: {incident.status})")
    return incident


@router.delete("/{incident_id}")
def delete_incident(
    incident_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    incident = db.query(models.Incident).filter(models.Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    db.delete(incident)
    db.commit()

    log_audit(db, current_user, "INCIDENT_DELETE", f"Deleted incident ID: {incident_id}")
    log_system(db, "WARNING", "incidents", f"Incident ID: {incident_id} deleted by {current_user.username}")

    return {"status": "success", "message": f"Incident {incident_id} deleted successfully."}

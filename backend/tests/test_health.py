"""Smoke tests for FireGuard AI backend."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

os.environ["SEED_DATABASE"] = "false"

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "FireGuard AI"
    assert "model_ready" in data


def test_dashboard_requires_auth():
    response = client.get("/api/v1/dashboard/stats")
    assert response.status_code == 401


def test_login_invalid_credentials():
    response = client.post(
        "/api/v1/auth/login",
        json={"username_or_email": "invalid@test.com", "password": "wrong"},
    )
    assert response.status_code == 401


def test_registration_role_assignment():
    # 1. Corporate domain gets requested role
    reg_payload_corp = {
        "username": "corp_op",
        "email": "corp_op@fireguard.ai",
        "password": "Password@123",
        "role": "operator"
    }
    response = client.post("/api/v1/auth/register", json=reg_payload_corp)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "operator"

    # 2. Public domain defaults to viewer even if operator requested
    reg_payload_public = {
        "username": "public_viewer",
        "email": "public_viewer@gmail.com",
        "password": "Password@123",
        "role": "operator"
    }
    response = client.post("/api/v1/auth/register", json=reg_payload_public)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "viewer"

    # 3. Public domain with "admin" prefix gets administrator
    reg_payload_admin_prefix = {
        "username": "prefixed_admin",
        "email": "test-admin-account@gmail.com",
        "password": "Password@123",
        "role": "viewer"
    }
    response = client.post("/api/v1/auth/register", json=reg_payload_admin_prefix)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "administrator"


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
    import uuid
    suffix = uuid.uuid4().hex[:8]

    # 1. Corporate domain gets requested role
    reg_payload_corp = {
        "username": f"corp_op_{suffix}",
        "email": f"corp_op_{suffix}@fireguard.ai",
        "password": "Password@123",
        "role": "operator"
    }
    response = client.post("/api/v1/auth/register", json=reg_payload_corp)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "operator"

    # 2. Public domain defaults to viewer even if operator requested
    reg_payload_public = {
        "username": f"public_viewer_{suffix}",
        "email": f"public_viewer_{suffix}@gmail.com",
        "password": "Password@123",
        "role": "operator"
    }
    response = client.post("/api/v1/auth/register", json=reg_payload_public)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "viewer"

    # 3. Public domain with "admin" prefix gets administrator
    reg_payload_admin_prefix = {
        "username": f"prefixed_admin_{suffix}",
        "email": f"test-admin-{suffix}@gmail.com",
        "password": "Password@123",
        "role": "viewer"
    }
    response = client.post("/api/v1/auth/register", json=reg_payload_admin_prefix)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "administrator"


def test_google_auth_simulator():
    import uuid
    suffix = uuid.uuid4().hex[:8]
    email = f"google_user_{suffix}@example.com"
    google_id = f"google_test_id_{suffix}"
    
    # 1. Test google register
    reg_payload = {
        "email": email,
        "google_id": google_id,
        "username": f"guser_{suffix}",
        "action": "register"
    }
    response = client.post("/api/v1/auth/google", json=reg_payload)
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["user"]["email"] == email
    assert data["user"]["google_linked"] == "true"
    assert data["user"]["google_id"] == google_id
    assert data["user"]["role"] == "viewer"
    
    # 2. Test google login
    login_payload = {
        "email": email,
        "google_id": google_id,
        "action": "login"
    }
    response = client.post("/api/v1/auth/google", json=login_payload)
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["user"]["email"] == email
    
    # 3. Test google link
    # Create standard user
    std_email = f"std_user_{suffix}@example.com"
    client.post("/api/v1/auth/register", json={
        "username": f"std_{suffix}",
        "email": std_email,
        "password": "Password@123",
        "role": "operator"
    })
    
    # Login to get token
    login_resp = client.post("/api/v1/auth/login", json={
        "username_or_email": std_email,
        "password": "Password@123"
    })
    token = login_resp.json()["token"]
    
    # Link google account to standard user
    link_google_id = f"google_link_{suffix}"
    link_payload = {
        "email": std_email,
        "google_id": link_google_id,
        "action": "link"
    }
    link_resp = client.post(
        "/api/v1/auth/google",
        json=link_payload,
        headers={"Authorization": f"Bearer {token}"}
    )
    assert link_resp.status_code == 200
    link_data = link_resp.json()
    assert link_data["user"]["google_linked"] == "true"
    assert link_data["user"]["google_id"] == link_google_id



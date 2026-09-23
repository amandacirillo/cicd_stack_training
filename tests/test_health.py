"""
This is the test the CI pipeline's `test` stage actually runs (see
.gitlab-ci.yml). Keeping it fast and dependency-free is intentional: the
`test` stage runs on every pipeline before deploy is allowed, so a slow or
flaky test suite here would slow down every single deploy.
"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_index_reports_environment(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "sandbox")
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["environment"] == "sandbox"

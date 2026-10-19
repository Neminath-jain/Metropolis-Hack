from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["project"] == "Aegis-Monad"
    assert data["chain_id"] == 10143


def test_health_mocked_chain():
    with patch("app.chain.client.chain_client.get_status") as mock_status:
        mock_status.return_value = {
            "status": "ok",
            "chain_id": 10143,
            "latest_block": 1234567,
        }
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["chain_id"] == 10143
        assert data["latest_block"] == 1234567

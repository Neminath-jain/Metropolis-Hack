from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from app.main import app
from app.schemas.models import ExecutionResult, ReasonCode

client = TestClient(app)


def test_api_root():
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["project"] == "Aegis-Monad"
    assert res.json()["chain_id"] == 10143


def test_api_status():
    res = client.get("/agent/status")
    assert res.status_code == 200
    data = res.json()
    assert "agent_address" in data
    assert data["chain_id"] == 10143
    assert data["demo_attacks_enabled"] is True


@patch("app.routers.agent.guardrails.verify_decision")
@patch("app.routers.agent.executor.execute_trade")
def test_api_run_once_guardrails_pass(mock_execute, mock_guardrails):
    mock_guardrails.return_value = (True, None)
    mock_execute.return_value = ExecutionResult(
        status="success",
        tx_hash="0x12345678",
        decision_hash="0xabcdef",
        spent=1_000_000,
        received=990_000,
    )

    res = client.post(
        "/agent/run-once",
        json={"user": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["tx_hash"] == "0x12345678"


@patch("app.routers.agent.guardrails.verify_decision")
def test_api_run_once_guardrails_refusal(mock_guardrails):
    mock_guardrails.return_value = (False, "Guardrail refusal: No active delegation session")

    res = client.post(
        "/agent/run-once",
        json={"user": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "rejected_by_guardrails"
    assert "No active delegation session" in data["details"]


@patch("app.routers.agent.executor.execute_trade")
def test_api_red_team_attack(mock_execute):
    mock_execute.return_value = ExecutionResult(
        status="policy_violation",
        tx_hash="0xattack9999",
        reason_code=ReasonCode.EXCEEDS_PER_TRADE,
        reason_name="EXCEEDS_PER_TRADE",
        decision_hash="0xdeadbeef",
        details="Execution blocked by policy engine: EXCEEDS_PER_TRADE",
    )

    res = client.post(
        "/agent/attack/over_limit",
        json={"user": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "policy_violation"
    assert data["reason_name"] == "EXCEEDS_PER_TRADE"


def test_api_decisions_list():
    res = client.get("/decisions")
    assert res.status_code == 200
    assert isinstance(res.json(), list)

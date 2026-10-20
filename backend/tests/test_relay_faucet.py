import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from web3 import Web3
from app.main import app
from app.config import settings
from app.routers.relay import relayer_manager, ALLOWED_SELECTORS
from app.routers.faucet import faucet_limiter

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """Reset rate limiter and spend tracker state before each test."""
    with relayer_manager.lock:
        relayer_manager.ip_timestamps.clear()
        relayer_manager.user_timestamps.clear()
        relayer_manager.daily_spent_wei = 0
    with faucet_limiter.lock:
        faucet_limiter.ip_timestamps.clear()
        faucet_limiter.user_timestamps.clear()


def test_relay_disallowed_target():
    res = client.post(
        "/relay",
        json={
            "target": "0x000000000000000000000000000000000000dEaD",
            "data": "0x3b3220f40000000000000000000000000000000000000000000000000000000000000001",
        },
    )
    assert res.status_code == 400
    assert "Disallowed target address" in res.json()["detail"]


def test_relay_disallowed_selector():
    res = client.post(
        "/relay",
        json={
            "target": settings.agent_guard_address,
            "data": "0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001",
        },
    )
    assert res.status_code == 400
    assert "Disallowed function selector" in res.json()["detail"]


def test_relay_rejects_deposit_for():
    # depositFor(address,address,uint256) selector is 0xb3db428b
    res = client.post(
        "/relay",
        json={
            "target": settings.agent_guard_address,
            "data": "0xb3db428b" + "00" * 96,
        },
    )
    assert res.status_code == 400
    assert "Disallowed function selector 0xb3db428b" in res.json()["detail"]


@patch("app.routers.relay.Web3")
def test_relay_allowed_selector_with_gas_margin_and_cap(mock_web3_class):
    mock_w3 = MagicMock()
    mock_web3_class.return_value = mock_w3
    mock_w3.is_connected.return_value = True

    # Simulate gas estimation: 100,000 gas
    mock_w3.eth.estimate_gas.return_value = 100_000
    mock_w3.eth.gas_price = 50_000_000_000  # 50 gwei
    mock_w3.eth.get_transaction_count.return_value = 5

    signed_mock = MagicMock()
    signed_mock.raw_transaction = b"fake_raw_tx"
    mock_w3.eth.account.sign_transaction.return_value = signed_mock
    mock_w3.eth.send_raw_transaction.return_value = MagicMock(hex=lambda: "0x1234abcd5678")

    # Allowed selector for registerPasskey
    res = client.post(
        "/relay",
        json={
            "target": settings.agent_guard_address,
            "data": "0x3b3220f4" + "00" * 64,
        },
    )

    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "submitted"
    assert data["tx_hash"] == "0x1234abcd5678"
    assert data["function_name"] == "registerPasskey"
    # Gas limit should strictly be 100,000 * 1.10 = 110,000
    assert data["gas_limit"] == 110_000


@patch("app.routers.relay.Web3")
def test_relay_enforces_gas_hard_cap(mock_web3_class):
    mock_w3 = MagicMock()
    mock_web3_class.return_value = mock_w3
    mock_w3.is_connected.return_value = True

    # Simulate huge estimate: 2,000,000 gas
    mock_w3.eth.estimate_gas.return_value = 2_000_000
    mock_w3.eth.gas_price = 10_000_000_000
    mock_w3.eth.get_transaction_count.return_value = 6

    signed_mock = MagicMock()
    signed_mock.raw_transaction = b"fake_raw_tx"
    mock_w3.eth.account.sign_transaction.return_value = signed_mock
    mock_w3.eth.send_raw_transaction.return_value = MagicMock(hex=lambda: "0x9876fedc")

    res = client.post(
        "/relay",
        json={
            "target": settings.agent_guard_address,
            "data": "0x3b3220f4" + "00" * 64,
        },
    )

    assert res.status_code == 200
    data = res.json()
    # Must be capped at relayer_gas_cap (1,000,000)
    assert data["gas_limit"] == settings.relayer_gas_cap


def test_relay_rate_limiting():
    # Attempt 21 requests from same client IP
    for i in range(20):
        # We test with disallowed selector so we don't need Web3 mocks for the first 20
        res = client.post(
            "/relay",
            json={
                "target": settings.agent_guard_address,
                "data": "0xdeadbeef" + "00" * 32,
            },
        )
        assert res.status_code == 400

    # 21st request should be rejected with 429
    res = client.post(
        "/relay",
        json={
            "target": settings.agent_guard_address,
            "data": "0x3b3220f4" + "00" * 64,
        },
    )
    assert res.status_code == 429
    assert "Rate limit exceeded" in res.json()["detail"]


@patch("app.routers.relay.Web3")
def test_relay_daily_spend_cap_enforced(mock_web3_class):
    mock_w3 = MagicMock()
    mock_web3_class.return_value = mock_w3
    mock_w3.is_connected.return_value = True

    # Set spent amount to almost the cap
    cap_wei = int(settings.daily_spend_cap_mon * 10**18)
    relayer_manager.daily_spent_wei = cap_wei

    mock_w3.eth.estimate_gas.return_value = 50_000
    mock_w3.eth.gas_price = 50_000_000_000

    res = client.post(
        "/relay",
        json={
            "target": settings.agent_guard_address,
            "data": "0x3b3220f4" + "00" * 64,
        },
    )
    assert res.status_code == 429
    assert "Daily relayer gas spend cap reached" in res.json()["detail"]


def test_faucet_invalid_address():
    res = client.post(
        "/faucet",
        json={"user": "invalid_eth_address"},
    )
    assert res.status_code == 400
    assert "Invalid Ethereum address" in res.json()["detail"]


@patch("app.routers.faucet.Web3")
def test_faucet_success_mock(mock_web3_class):
    mock_web3_class.is_address = Web3.is_address
    mock_web3_class.to_checksum_address = Web3.to_checksum_address

    mock_w3 = MagicMock()
    mock_web3_class.return_value = mock_w3
    mock_w3.is_connected.return_value = True
    mock_w3.eth.gas_price = 20_000_000_000
    mock_w3.eth.get_transaction_count.return_value = 10

    mock_contract = MagicMock()
    mock_w3.eth.contract.return_value = mock_contract

    # Allowance >= amount so no approve tx needed
    mock_contract.functions.allowance.return_value.call.return_value = 100 * 10**18

    mock_receipt = MagicMock()
    mock_receipt.transactionHash.hex.return_value = "0xfaucet_tx_hash_123"
    mock_w3.eth.wait_for_transaction_receipt.return_value = mock_receipt

    user_addr = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    res = client.post(
        "/faucet",
        json={"user": user_addr},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["is_mock"] is True
    assert "mWMON" in data["token_symbol"]
    assert "0xfaucet_tx_hash_123" in data["tx_hash"]


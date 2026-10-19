import pytest
import time
from unittest.mock import MagicMock
from app.agent.guardrails import GuardrailsEnforcer
from app.schemas.models import Decision, TradeAction


@pytest.fixture
def mock_guard_client():
    client = MagicMock()
    client.agent_address = "0xAgent000000000000000000000000000000000001"
    # Default valid session
    client.get_session.return_value = {
        "active": True,
        "expires_at": int(time.time()) + 3600,
        "agent_id": 1,
    }
    # Default valid token limit
    client.get_limit.return_value = {
        "daily_limit": 100_000_000,
        "per_trade_limit": 10_000_000,
        "spent_in_window": 0,
        "window_start": int(time.time()),
    }
    # Default window remaining
    client.window_remaining.return_value = (50_000_000, 3600)
    # Default vault balance
    client.get_vault_balance.return_value = 100_000_000
    return client


def test_guardrails_pass_valid_trade(mock_guard_client):
    enforcer = GuardrailsEnforcer(mock_guard_client)
    decision = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=5_000_000,
        min_amount_out=4_900_000,
        rationale="Valid trade",
    )
    passed, reason = enforcer.verify_decision("0xUser", decision)
    assert passed is True
    assert reason is None


def test_guardrails_hold_always_passes(mock_guard_client):
    enforcer = GuardrailsEnforcer(mock_guard_client)
    decision = Decision(
        action=TradeAction.HOLD,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=0,
        min_amount_out=0,
        rationale="Hold",
    )
    passed, reason = enforcer.verify_decision("0xUser", decision)
    assert passed is True


def test_guardrails_refuse_no_session(mock_guard_client):
    mock_guard_client.get_session.return_value = {"active": False, "expires_at": 0}
    enforcer = GuardrailsEnforcer(mock_guard_client)
    decision = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=5_000_000,
        min_amount_out=4_900_000,
        rationale="Trade",
    )
    passed, reason = enforcer.verify_decision("0xUser", decision)
    assert passed is False
    assert "No active delegation session" in reason


def test_guardrails_refuse_expired_session(mock_guard_client):
    mock_guard_client.get_session.return_value = {
        "active": True,
        "expires_at": int(time.time()) - 10,
    }
    enforcer = GuardrailsEnforcer(mock_guard_client)
    decision = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=5_000_000,
        min_amount_out=4_900_000,
        rationale="Trade",
    )
    passed, reason = enforcer.verify_decision("0xUser", decision)
    assert passed is False
    assert "expired" in reason


def test_guardrails_refuse_unauthorized_token(mock_guard_client):
    mock_guard_client.get_limit.return_value = {
        "daily_limit": 0,
        "per_trade_limit": 0,
    }
    enforcer = GuardrailsEnforcer(mock_guard_client)
    decision = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=5_000_000,
        min_amount_out=4_900_000,
        rationale="Trade",
    )
    passed, reason = enforcer.verify_decision("0xUser", decision)
    assert passed is False
    assert "dailyLimit == 0" in reason


def test_guardrails_refuse_exceeds_per_trade(mock_guard_client):
    mock_guard_client.get_limit.return_value = {
        "daily_limit": 100_000_000,
        "per_trade_limit": 5_000_000,
    }
    enforcer = GuardrailsEnforcer(mock_guard_client)
    decision = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=10_000_000,  # Exceeds per_trade_limit of 5_000_000
        min_amount_out=9_000_000,
        rationale="Trade",
    )
    passed, reason = enforcer.verify_decision("0xUser", decision)
    assert passed is False
    assert "exceeds perTradeLimit" in reason


def test_guardrails_refuse_exceeds_daily_window(mock_guard_client):
    # Only 2_000_000 remaining in current window
    mock_guard_client.window_remaining.return_value = (2_000_000, 1800)
    enforcer = GuardrailsEnforcer(mock_guard_client)
    decision = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=5_000_000,
        min_amount_out=4_900_000,
        rationale="Trade",
    )
    passed, reason = enforcer.verify_decision("0xUser", decision)
    assert passed is False
    assert "daily remaining budget" in reason


def test_guardrails_refuse_insufficient_vault_balance(mock_guard_client):
    # User only has 1_000_000 deposited in vault
    mock_guard_client.get_vault_balance.return_value = 1_000_000
    enforcer = GuardrailsEnforcer(mock_guard_client)
    decision = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=5_000_000,
        min_amount_out=4_900_000,
        rationale="Trade",
    )
    passed, reason = enforcer.verify_decision("0xUser", decision)
    assert passed is False
    assert "vault balance" in reason

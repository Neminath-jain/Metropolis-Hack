import tempfile
from unittest.mock import MagicMock
from app.agent.executor import TradeExecutor
from app.schemas.models import (
    SignalData,
    Decision,
    TradeAction,
    ReasonCode,
    ExecutionResult,
)


def test_executor_hold_does_not_call_chain():
    mock_guard = MagicMock()
    with tempfile.TemporaryDirectory() as tmpdir:
        executor = TradeExecutor(mock_guard, data_dir=tmpdir)

        signals = SignalData(
            token_in="0x1111111111111111111111111111111111111111",
            token_out="0x2222222222222222222222222222222222222222",
            price=1.0,
            moving_average_1h=1.0,
            volume_24h=1000.0,
            timestamp=1700000000,
        )
        decision = Decision(
            action=TradeAction.HOLD,
            token_in="0x1111111111111111111111111111111111111111",
            token_out="0x2222222222222222222222222222222222222222",
            amount_in=0,
            min_amount_out=0,
            rationale="Hold",
        )

        result = executor.execute_trade("0x3333333333333333333333333333333333333333", signals, decision)
        assert result.status == "success"
        assert "no onchain action required" in result.details
        assert mock_guard.execute.called is False
        assert len(executor.get_decisions()) == 1


def test_executor_action_executed_parsing():
    mock_guard = MagicMock()
    # Mock receipt processing for ActionExecuted
    mock_guard.execute.return_value = ExecutionResult(
        status="success",
        tx_hash="0xabcd1234",
        decision_hash="0x5678",
        spent=1_000_000,
        received=990_000,
        block_number=12345,
        details="Action executed successfully within policy limits.",
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        executor = TradeExecutor(mock_guard, data_dir=tmpdir)

        signals = SignalData(
            token_in="0x1111111111111111111111111111111111111111",
            token_out="0x2222222222222222222222222222222222222222",
            price=1.02,
            moving_average_1h=1.0,
            volume_24h=1000.0,
            timestamp=1700000000,
        )
        decision = Decision(
            action=TradeAction.BUY,
            token_in="0x1111111111111111111111111111111111111111",
            token_out="0x2222222222222222222222222222222222222222",
            amount_in=1_000_000,
            min_amount_out=990_000,
            rationale="Execute swap",
        )

        result = executor.execute_trade("0x3333333333333333333333333333333333333333", signals, decision)
        assert result.status == "success"
        assert result.tx_hash == "0xabcd1234"
        assert result.spent == 1_000_000
        assert result.received == 990_000
        assert mock_guard.execute.called is True


def test_executor_policy_violation_parsing():
    mock_guard = MagicMock()
    mock_guard.execute.return_value = ExecutionResult(
        status="policy_violation",
        tx_hash="0xdead9999",
        reason_code=ReasonCode.EXCEEDS_PER_TRADE,
        reason_name="EXCEEDS_PER_TRADE",
        decision_hash="0x5678",
        block_number=12346,
        details="Execution blocked by policy engine: EXCEEDS_PER_TRADE",
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        executor = TradeExecutor(mock_guard, data_dir=tmpdir)

        signals = SignalData(
            token_in="0x1111111111111111111111111111111111111111",
            token_out="0x2222222222222222222222222222222222222222",
            price=1.0,
            moving_average_1h=1.0,
            volume_24h=1000.0,
            timestamp=1700000000,
        )
        decision = Decision(
            action=TradeAction.BUY,
            token_in="0x1111111111111111111111111111111111111111",
            token_out="0x2222222222222222222222222222222222222222",
            amount_in=50_000_000,
            min_amount_out=49_000_000,
            rationale="Over-limit swap",
        )

        result = executor.execute_trade("0x3333333333333333333333333333333333333333", signals, decision)
        assert result.status == "policy_violation"
        assert result.reason_code == ReasonCode.EXCEEDS_PER_TRADE
        assert result.reason_name == "EXCEEDS_PER_TRADE"

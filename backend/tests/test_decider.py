from unittest.mock import MagicMock
from app.agent.decider import RuleDecider, QwenDecider
from app.schemas.models import SignalData, TradeAction, Decision


def test_rule_decider_buy_when_above_moving_average():
    decider = RuleDecider()
    signals = SignalData(
        token_in="0xTokenA",
        token_out="0xTokenB",
        price=1.05,
        moving_average_1h=1.00,
        volume_24h=10000.0,
        timestamp=1700000000,
    )
    decision = decider.decide(signals, {})
    assert decision.action == TradeAction.BUY
    assert decision.amount_in > 0
    assert decision.min_amount_out > 0


def test_rule_decider_sell_when_below_moving_average():
    decider = RuleDecider()
    signals = SignalData(
        token_in="0xTokenA",
        token_out="0xTokenB",
        price=0.95,
        moving_average_1h=1.00,
        volume_24h=10000.0,
        timestamp=1700000000,
    )
    decision = decider.decide(signals, {})
    assert decision.action == TradeAction.SELL


def test_rule_decider_forced_action():
    decider = RuleDecider()
    signals = SignalData(
        token_in="0xTokenA",
        token_out="0xTokenB",
        price=1.00,
        moving_average_1h=1.00,
        volume_24h=10000.0,
        timestamp=1700000000,
    )
    decision = decider.decide(signals, {"force_action": "HOLD"})
    assert decision.action == TradeAction.HOLD
    assert decision.amount_in == 0


def test_qwen_decider_fallback_when_no_api_key():
    # Without API key, falls back seamlessly to RuleDecider
    decider = QwenDecider(api_key="")
    signals = SignalData(
        token_in="0xTokenA",
        token_out="0xTokenB",
        price=1.05,
        moving_average_1h=1.00,
        volume_24h=10000.0,
        timestamp=1700000000,
    )
    decision = decider.decide(signals, {})
    assert decision.action == TradeAction.BUY


def test_qwen_decider_json_validation_and_retry():
    decider = QwenDecider(api_key="test-key")
    mock_client = MagicMock()
    decider.client = mock_client

    # First attempt raises exception, second attempt returns valid JSON
    valid_json = """
    {
        "action": "BUY",
        "token_in": "0xTokenA",
        "token_out": "0xTokenB",
        "amount_in": 1000000000000000000,
        "min_amount_out": 990000000000000000,
        "rationale": "Qwen quantitative model detected breakout pattern.",
        "confidence": 0.92
    }
    """
    mock_choice = MagicMock()
    mock_choice.message.content = valid_json
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    mock_client.chat.completions.create.side_effect = [
        Exception("Temporary network timeout"),
        mock_response,
    ]

    signals = SignalData(
        token_in="0xTokenA",
        token_out="0xTokenB",
        price=1.05,
        moving_average_1h=1.00,
        volume_24h=10000.0,
        timestamp=1700000000,
    )
    decision = decider.decide(signals, {})
    assert decision.action == TradeAction.BUY
    assert decision.confidence == 0.92
    assert "breakout pattern" in decision.rationale


def test_qwen_decider_fallback_to_hold_on_repeated_failure():
    decider = QwenDecider(api_key="test-key")
    mock_client = MagicMock()
    decider.client = mock_client

    mock_client.chat.completions.create.side_effect = Exception("Persistent API error")

    signals = SignalData(
        token_in="0xTokenA",
        token_out="0xTokenB",
        price=1.05,
        moving_average_1h=1.00,
        volume_24h=10000.0,
        timestamp=1700000000,
    )
    decision = decider.decide(signals, {})
    assert decision.action == TradeAction.HOLD
    assert "safety fallback to HOLD" in decision.rationale

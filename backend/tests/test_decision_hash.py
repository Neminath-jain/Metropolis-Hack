from app.agent.executor import compute_canonical_decision_hash
from app.schemas.models import SignalData, Decision, TradeAction


def test_decision_hash_determinism():
    signals = SignalData(
        token_in="0xTokenA",
        token_out="0xTokenB",
        price=1.05,
        moving_average_1h=1.00,
        volume_24h=50000.0,
        timestamp=1700000000,
        is_mock=True,
    )
    decision = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=1_000_000,
        min_amount_out=990_000,
        rationale="Price momentum",
    )
    timestamp = 1700000005

    bytes1, hex1 = compute_canonical_decision_hash(signals, decision, timestamp)
    bytes2, hex2 = compute_canonical_decision_hash(signals, decision, timestamp)

    assert bytes1 == bytes2
    assert hex1 == hex2
    assert hex1.startswith("0x")
    assert len(hex1) == 66  # 0x + 64 hex characters (32 bytes)


def test_decision_hash_changes_with_modified_data():
    signals = SignalData(
        token_in="0xTokenA",
        token_out="0xTokenB",
        price=1.05,
        moving_average_1h=1.00,
        volume_24h=50000.0,
        timestamp=1700000000,
    )
    decision1 = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=1_000_000,
        min_amount_out=990_000,
        rationale="Price momentum",
    )
    decision2 = Decision(
        action=TradeAction.BUY,
        token_in="0xTokenA",
        token_out="0xTokenB",
        amount_in=1_000_001,  # Altered amount by 1 wei
        min_amount_out=990_000,
        rationale="Price momentum",
    )

    _, hex1 = compute_canonical_decision_hash(signals, decision1, 1700000000)
    _, hex2 = compute_canonical_decision_hash(signals, decision2, 1700000000)

    assert hex1 != hex2

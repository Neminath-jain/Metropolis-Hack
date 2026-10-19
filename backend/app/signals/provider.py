"""
Signal Provider Interface and Implementations.

SECURITY NOTICE:
Signals from providers represent UNTRUSTED external market data.
They are never treated as direct execution instructions or policy overrides.
All trade decisions derived from signals are subject to deterministic off-chain
guardrails and immutable on-chain AgentGuard constraints.
"""

from abc import ABC, abstractmethod
import math
import time
from typing import Optional
import httpx
from app.schemas.models import SignalData


class SignalProvider(ABC):
    @abstractmethod
    def get_signals(self, token_in: str, token_out: str) -> SignalData:
        """Fetches current price and market signals for a given token pair."""
        pass


class MockSignalProvider(SignalProvider):
    """
    Deterministic, seeded signal generator.
    Simulates oscillating price action around a 1:1 base parity for WMON/USDT.
    Flagged clearly as MOCK.
    """

    def __init__(self, base_price: float = 1.0, seed_offset: int = 0):
        self.base_price = base_price
        self.seed_offset = seed_offset
        self.step_counter = 0

    def get_signals(self, token_in: str, token_out: str) -> SignalData:
        now = int(time.time())
        # Predictable oscillation for testing: +/- 3%
        self.step_counter += 1
        variation = 0.03 * math.sin((self.step_counter + self.seed_offset) * 0.5)
        current_price = round(self.base_price * (1.0 + variation), 4)
        moving_average = round(self.base_price, 4)

        return SignalData(
            token_in=token_in,
            token_out=token_out,
            price=current_price,
            moving_average_1h=moving_average,
            volume_24h=150_000.0,
            timestamp=now,
            is_mock=True,
            source="MOCK-DETERMINISTIC",
        )


class LiveSignalProvider(SignalProvider):
    """
    Optional live public price provider with automatic fallback to mock.
    """

    def __init__(self, fallback: Optional[SignalProvider] = None):
        self.fallback = fallback or MockSignalProvider()

    def get_signals(self, token_in: str, token_out: str) -> SignalData:
        try:
            # Attempt to query public crypto price (e.g., CoinGecko simple price for WETH/USDT proxy)
            # Short timeout to avoid blocking execution loop
            with httpx.Client(timeout=2.0) as client:
                res = client.get(
                    "https://api.coingecko.com/api/v3/simple/price",
                    params={"ids": "monad,ethereum", "vs_currencies": "usd"},
                )
                if res.status_code == 200:
                    data = res.json()
                    price = float(data.get("monad", {}).get("usd", 1.0))
                    return SignalData(
                        token_in=token_in,
                        token_out=token_out,
                        price=price,
                        moving_average_1h=price,
                        volume_24h=1_000_000.0,
                        timestamp=int(time.time()),
                        is_mock=False,
                        source="live-coingecko",
                    )
        except Exception:
            pass

        # Fallback to mock on any network or parsing error
        return self.fallback.get_signals(token_in, token_out)

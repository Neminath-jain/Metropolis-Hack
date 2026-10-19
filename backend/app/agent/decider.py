"""
Agent Decider Interface and Implementations.
Default: RuleDecider (zero external dependencies).
Optional: QwenDecider (Alibaba Cloud Model Studio DashScope endpoint).
"""

from abc import ABC, abstractmethod
import json
from typing import Dict, Any, Optional
from app.config import settings
from app.schemas.models import SignalData, Decision, TradeAction


class Decider(ABC):
    @abstractmethod
    def decide(self, signals: SignalData, context: Dict[str, Any]) -> Decision:
        """Evaluates market signals and generates a bounded trade decision."""
        pass


class RuleDecider(Decider):
    """
    Deterministic rule-based reasoning engine.
    Ensures standalone offline execution without external API keys.
    """

    def decide(self, signals: SignalData, context: Dict[str, Any]) -> Decision:
        # Check if caller forced an action for testing
        forced = context.get("force_action")
        if forced:
            action = TradeAction(forced)
        elif signals.price >= signals.moving_average_1h:
            action = TradeAction.BUY
        else:
            action = TradeAction.SELL

        # Standard test trade amount: 1 unit of token (1e18) or context specified
        raw_amount = context.get("amount_in", 1_000_000_000_000_000_000)  # 1 ether
        # 1% slippage floor (99% of input)
        min_out = int(raw_amount * 0.99)

        diff_pct = (
            ((signals.price - signals.moving_average_1h) / signals.moving_average_1h)
            * 100.0
            if signals.moving_average_1h > 0
            else 0.0
        )

        rationale = (
            f"RuleDecider: Price ({signals.price:.4f}) is {diff_pct:+.2f}% "
            f"vs 1h MA ({signals.moving_average_1h:.4f}). Triggering {action.value}."
        )

        return Decision(
            action=action,
            token_in=signals.token_in,
            token_out=signals.token_out,
            amount_in=raw_amount if action != TradeAction.HOLD else 0,
            min_amount_out=min_out if action != TradeAction.HOLD else 0,
            rationale=rationale,
            confidence=0.95,
        )


class QwenDecider(Decider):
    """
    Autonomous LLM Reasoning Brain using Alibaba Cloud Qwen (Model Studio / DashScope).
    Connects to the OpenAI-compatible endpoint.
    Retries once on error, falls back safely to TradeAction.HOLD.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
    ):
        self.api_key = api_key or settings.dashscope_api_key
        self.base_url = base_url or settings.dashscope_base_url
        self.model = model or settings.qwen_model
        self.client = None

        if self.api_key:
            try:
                from openai import OpenAI

                self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)
            except Exception:
                self.client = None

    def decide(self, signals: SignalData, context: Dict[str, Any]) -> Decision:
        if not self.client:
            # Fallback to RuleDecider if Qwen is not configured
            return RuleDecider().decide(signals, context)

        prompt = (
            f"You are an autonomous AI trading agent operating under Aegis-Monad onchain guardrails.\n"
            f"Analyze the market signals below and formulate a trade decision (BUY, SELL, or HOLD).\n\n"
            f"Token In: {signals.token_in}\n"
            f"Token Out: {signals.token_out}\n"
            f"Price: {signals.price}\n"
            f"Moving Average 1h: {signals.moving_average_1h}\n"
            f"24h Volume: {signals.volume_24h}\n"
            f"User Context: {json.dumps(context)}\n\n"
            f"Respond ONLY with valid JSON matching this schema:\n"
            f"{{\n"
            f'  "action": "BUY" | "SELL" | "HOLD",\n'
            f'  "token_in": "{signals.token_in}",\n'
            f'  "token_out": "{signals.token_out}",\n'
            f'  "amount_in": <integer in wei>,\n'
            f'  "min_amount_out": <integer in wei>,\n'
            f'  "rationale": "<your step-by-step reasoning>",\n'
            f'  "confidence": <float between 0.0 and 1.0>\n'
            f"}}"
        )

        for attempt in range(2):  # Try once, retry once
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a quantitative trading agent returning strict JSON.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=500,
                )
                content = response.choices[0].message.content
                data = json.loads(content)
                return Decision.model_validate(data)
            except Exception:
                if attempt == 1:
                    break

        # Fallback to HOLD if LLM fails
        return Decision(
            action=TradeAction.HOLD,
            token_in=signals.token_in,
            token_out=signals.token_out,
            amount_in=0,
            min_amount_out=0,
            rationale="QwenDecider: LLM reasoning error or timeout; safety fallback to HOLD.",
            confidence=0.0,
        )

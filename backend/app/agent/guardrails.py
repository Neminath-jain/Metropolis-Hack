"""
Off-Chain Policy Guardrails for Aegis-Monad Agent.

SECURITY ARCHITECTURE NOTE:
These off-chain checks act as a client-side convenience layer to prevent the agent
from signing and submitting transactions that would inevitably fail onchain, saving
agent gas and transaction fees.

The authoritative enforcement engine is the onchain AgentGuard smart contract itself.
Even if an agent's backend is completely compromised or these off-chain checks are bypassed
(e.g., in red-team demo attacks), the contract deterministically halts any unauthorized trade.
"""

import time
from typing import Tuple, Optional
from app.chain.guard import AgentGuardClient
from app.schemas.models import Decision, TradeAction


class GuardrailsEnforcer:
    def __init__(self, guard_client: AgentGuardClient):
        self.guard = guard_client

    def verify_decision(
        self, user: str, decision: Decision
    ) -> Tuple[bool, Optional[str]]:
        """
        Validates a proposed trade decision against the onchain session and limits.
        Returns (passed, refusal_reason).
        """
        if decision.action == TradeAction.HOLD:
            return True, None

        if decision.amount_in <= 0:
            return False, "Invalid trade amount: must be greater than 0"

        now = int(time.time())

        # 1. Verify Active Session
        session = self.guard.get_session(user)
        if not session.get("active"):
            return False, "Guardrail refusal: No active delegation session found for user"

        if now > session.get("expires_at", 0):
            return False, "Guardrail refusal: Delegation session has expired"

        # 2. Verify Token Limit Configuration
        limit = self.guard.get_limit(user, self.guard.agent_address, decision.token_in)
        daily_limit = limit.get("daily_limit", 0)
        per_trade_limit = limit.get("per_trade_limit", 0)

        if daily_limit == 0:
            return False, f"Guardrail refusal: Token {decision.token_in} is not tradable (dailyLimit == 0)"

        # 3. Verify Per-Trade Spending Cap
        if decision.amount_in > per_trade_limit:
            return (
                False,
                f"Guardrail refusal: Trade amount ({decision.amount_in}) exceeds perTradeLimit ({per_trade_limit})",
            )

        # 4. Verify 24h Rolling Window Remaining Budget
        remaining_budget, _ = self.guard.window_remaining(
            user, self.guard.agent_address, decision.token_in
        )
        if decision.amount_in > remaining_budget:
            return (
                False,
                f"Guardrail refusal: Trade amount ({decision.amount_in}) exceeds daily remaining budget ({remaining_budget})",
            )

        # 5. Check Internal Vault Balance
        vault_balance = self.guard.get_vault_balance(user, decision.token_in)
        if decision.amount_in > vault_balance:
            return (
                False,
                f"Guardrail refusal: Trade amount ({decision.amount_in}) exceeds user vault balance ({vault_balance})",
            )

        return True, None

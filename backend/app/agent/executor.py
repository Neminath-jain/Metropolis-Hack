"""
Agent Executor for Aegis-Monad.
Computes cryptographic decisionHash, formats swap calldata, dispatches onchain transactions,
and records execution audits.
"""

import json
import os
import time
from typing import Dict, Any, List, Optional, Tuple
from web3 import Web3
from app.chain.guard import AgentGuardClient
from app.config import settings
from app.schemas.models import (
    SignalData,
    Decision,
    DecisionAudit,
    ExecutionResult,
    TradeAction,
)
from app.venues.mock_dex import build_swap_calldata


def compute_canonical_decision_hash(
    signals: SignalData, decision: Decision, timestamp: int
) -> Tuple[bytes, str]:
    """
    Computes deterministic keccak256 hash of canonical JSON:
    {signals, decision, rationale, timestamp} with sorted keys and no whitespace.
    """
    audit_dict = {
        "decision": {
            "action": decision.action.value,
            "amount_in": decision.amount_in,
            "min_amount_out": decision.min_amount_out,
            "token_in": decision.token_in,
            "token_out": decision.token_out,
        },
        "rationale": decision.rationale,
        "signals": {
            "price": signals.price,
            "moving_average_1h": signals.moving_average_1h,
            "timestamp": signals.timestamp,
            "token_in": signals.token_in,
            "token_out": signals.token_out,
            "volume_24h": signals.volume_24h,
        },
        "timestamp": timestamp,
    }
    canonical_json = json.dumps(audit_dict, sort_keys=True, separators=(",", ":"))
    hash_bytes = Web3.keccak(text=canonical_json)
    return hash_bytes, "0x" + hash_bytes.hex()


class TradeExecutor:
    def __init__(
        self,
        guard_client: AgentGuardClient,
        data_dir: Optional[str] = None,
    ):
        self.guard = guard_client
        self.data_dir = data_dir or os.path.join(
            os.path.dirname(__file__), "../../../data"
        )
        os.makedirs(self.data_dir, exist_ok=True)
        self.decisions_file = os.path.join(self.data_dir, "decisions.json")

        self.in_memory_decisions: List[DecisionAudit] = []
        self._load_persisted_decisions()

    def _load_persisted_decisions(self):
        if os.path.exists(self.decisions_file):
            try:
                with open(self.decisions_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.in_memory_decisions = [
                        DecisionAudit.model_validate(item) for item in data
                    ]
            except Exception:
                self.in_memory_decisions = []

    def _persist_decision(self, audit: DecisionAudit):
        self.in_memory_decisions.append(audit)
        try:
            with open(self.decisions_file, "w", encoding="utf-8") as f:
                json.dump(
                    [d.model_dump() for d in self.in_memory_decisions],
                    f,
                    indent=2,
                )
        except Exception:
            pass

    def get_decisions(self) -> List[DecisionAudit]:
        return self.in_memory_decisions

    def execute_trade(
        self,
        user: str,
        signals: SignalData,
        decision: Decision,
        target_override: Optional[str] = None,
        calldata_override: Optional[bytes] = None,
    ) -> ExecutionResult:
        """
        Executes a trade decision onchain via AgentGuard.execute.
        """
        now = int(time.time())
        hash_bytes, hash_hex = compute_canonical_decision_hash(signals, decision, now)

        # Audit record
        audit = DecisionAudit(
            signals=signals.model_dump(),
            decision=decision.model_dump(),
            rationale=decision.rationale,
            timestamp=now,
            decision_hash=hash_hex,
        )
        self._persist_decision(audit)

        if decision.action == TradeAction.HOLD:
            return ExecutionResult(
                status="success",
                decision_hash=hash_hex,
                details="Decision was HOLD; no onchain action required.",
            )

        target = Web3.to_checksum_address(target_override or settings.venue_address)
        calldata = calldata_override or build_swap_calldata(
            token_in=decision.token_in,
            token_out=decision.token_out,
            amount_in=decision.amount_in,
            min_amount_out=decision.min_amount_out,
            recipient=user,
        )

        try:
            return self.guard.execute(
                user=user,
                token_in=decision.token_in,
                amount_in=decision.amount_in,
                token_out=decision.token_out,
                min_amount_out=decision.min_amount_out,
                target=target,
                data=calldata,
                decision_hash=hash_bytes,
            )
        except Exception as e:
            return ExecutionResult(
                status="error",
                decision_hash=hash_hex,
                details=f"Execution error: {str(e)}",
            )

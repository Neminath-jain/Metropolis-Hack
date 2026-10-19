"""
Pydantic v2 Models and Enums for Aegis-Monad Reference Agent.
"""

from enum import Enum, IntEnum
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field, ConfigDict


class TradeAction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class ReasonCode(IntEnum):
    NO_SESSION = 0
    EXPIRED = 1
    TARGET_NOT_ALLOWED = 2
    SELECTOR_NOT_ALLOWED = 3
    TOKEN_NOT_ALLOWED = 4
    EXCEEDS_PER_TRADE = 5
    EXCEEDS_DAILY = 6
    INSUFFICIENT_BALANCE = 7
    BAD_PAIR = 8


class SignalData(BaseModel):
    model_config = ConfigDict(frozen=True)

    token_in: str
    token_out: str
    price: float
    moving_average_1h: float
    volume_24h: float
    timestamp: int
    is_mock: bool = True
    source: str = "mock-seeded"


class Decision(BaseModel):
    model_config = ConfigDict(frozen=True)

    action: TradeAction
    token_in: str
    token_out: str
    amount_in: int = Field(default=0, description="Amount in raw token units")
    min_amount_out: int = Field(default=0, description="Minimum expected output in raw units")
    rationale: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class DecisionAudit(BaseModel):
    signals: Dict[str, Any]
    decision: Dict[str, Any]
    rationale: str
    timestamp: int
    decision_hash: str


class ExecutionResult(BaseModel):
    status: str = Field(description="success | policy_violation | rejected_by_guardrails | error")
    tx_hash: Optional[str] = None
    reason_code: Optional[ReasonCode] = None
    reason_name: Optional[str] = None
    decision_hash: str
    spent: int = 0
    received: int = 0
    block_number: Optional[int] = None
    details: Optional[str] = None


class AgentStatus(BaseModel):
    agent_address: str
    agent_id: Optional[int] = None
    agent_guard_address: str
    chain_id: int
    rpc_connected: bool
    latest_block: int
    demo_attacks_enabled: bool
    qwen_enabled: bool


class RunOnceRequest(BaseModel):
    user: str = Field(description="User address who delegated trading session")
    token_in: Optional[str] = None
    token_out: Optional[str] = None
    force_action: Optional[TradeAction] = None


class AttackKind(str, Enum):
    OVER_LIMIT = "over_limit"
    BAD_TARGET = "bad_target"
    BAD_SELECTOR = "bad_selector"


class AttackRequest(BaseModel):
    user: str
    token_in: Optional[str] = None
    token_out: Optional[str] = None
    custom_amount: Optional[int] = None

"""
Agent Execution, Status, Audit, and Red-Team Attack Routers.
"""

import asyncio
from typing import List, Set
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from app.config import settings
from app.chain.client import chain_client
from app.chain.guard import AgentGuardClient
from app.signals.provider import MockSignalProvider, LiveSignalProvider
from app.agent.decider import RuleDecider, QwenDecider
from app.agent.guardrails import GuardrailsEnforcer
from app.agent.executor import TradeExecutor, compute_canonical_decision_hash
from app.schemas.models import (
    AgentStatus,
    RunOnceRequest,
    ExecutionResult,
    DecisionAudit,
    AttackKind,
    AttackRequest,
    SignalData,
    Decision,
    TradeAction,
)
import time

router = APIRouter(prefix="/agent", tags=["Agent"])

# Initialize singletons
guard_client = AgentGuardClient()
signal_provider = MockSignalProvider()
decider = RuleDecider()
guardrails = GuardrailsEnforcer(guard_client)
executor = TradeExecutor(guard_client)

# Active WebSocket connections
active_connections: Set[WebSocket] = set()


async def broadcast_ws(data: dict):
    for ws in list(active_connections):
        try:
            await ws.send_json(data)
        except Exception:
            active_connections.discard(ws)


@router.get("/status", response_model=AgentStatus)
def get_status():
    rpc_ok = chain_client.is_connected()
    latest_block = chain_client.get_latest_block_number() if rpc_ok else 0

    return AgentStatus(
        agent_address=guard_client.agent_address,
        agent_id=settings.agent_id,
        agent_guard_address=settings.agent_guard_address,
        chain_id=settings.chain_id,
        rpc_connected=rpc_ok,
        latest_block=latest_block,
        demo_attacks_enabled=settings.demo_attacks,
        qwen_enabled=bool(settings.dashscope_api_key),
    )


@router.post("/run-once", response_model=ExecutionResult)
async def run_once(req: RunOnceRequest):
    # Default tokens if not specified
    token_in = req.token_in or "0x1111111111111111111111111111111111111111"
    token_out = req.token_out or "0x2222222222222222222222222222222222222222"

    # 1. Fetch market signals
    signals = signal_provider.get_signals(token_in, token_out)

    # 2. Formulate decision
    context = {"user": req.user}
    if req.force_action:
        context["force_action"] = req.force_action.value
    decision = decider.decide(signals, context)

    # 3. Off-chain Guardrails verification (convenience layer)
    passed, refusal_reason = guardrails.verify_decision(req.user, decision)
    if not passed:
        now = int(time.time())
        _, hash_hex = compute_canonical_decision_hash(signals, decision, now)
        res = ExecutionResult(
            status="rejected_by_guardrails",
            decision_hash=hash_hex,
            details=refusal_reason,
        )
        await broadcast_ws(
            {
                "type": "run_once",
                "signals": signals.model_dump(),
                "decision": decision.model_dump(),
                "guardrails_passed": False,
                "result": res.model_dump(),
            }
        )
        return res

    # 4. Dispatch onchain execution
    result = executor.execute_trade(req.user, signals, decision)

    await broadcast_ws(
        {
            "type": "run_once",
            "signals": signals.model_dump(),
            "decision": decision.model_dump(),
            "guardrails_passed": True,
            "result": result.model_dump(),
        }
    )
    return result


@router.get("/decisions", response_model=List[DecisionAudit])
def get_decisions():
    return executor.get_decisions()


@router.post("/attack/{kind}", response_model=ExecutionResult)
async def red_team_attack(kind: AttackKind, req: AttackRequest):
    """
    RED-TEAM DEMO ENDPOINT:
    Deliberately bypasses the off-chain guardrails to demonstrate that the
    on-chain AgentGuard contract itself halts malicious or rule-violating transactions.
    """
    if not settings.demo_attacks:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Red-team demo attacks are disabled in configuration (DEMO_ATTACKS=false).",
        )

    token_in = req.token_in or "0x1111111111111111111111111111111111111111"
    token_out = req.token_out or "0x2222222222222222222222222222222222222222"

    signals = signal_provider.get_signals(token_in, token_out)

    target_override = None
    calldata_override = None

    if kind == AttackKind.OVER_LIMIT:
        # Deliberately exceed limit: 1,000,000 ether
        huge_amount = req.custom_amount or 1_000_000_000_000_000_000_000_000
        decision = Decision(
            action=TradeAction.BUY,
            token_in=token_in,
            token_out=token_out,
            amount_in=huge_amount,
            min_amount_out=huge_amount,
            rationale="RED-TEAM ATTACK: Deliberately exceeding authorized perTradeLimit and dailyLimit.",
            confidence=1.0,
        )

    elif kind == AttackKind.BAD_TARGET:
        decision = Decision(
            action=TradeAction.BUY,
            token_in=token_in,
            token_out=token_out,
            amount_in=100_000_000_000_000_000,
            min_amount_out=90_000_000_000_000_000,
            rationale="RED-TEAM ATTACK: Calling unauthorized target address.",
            confidence=1.0,
        )
        target_override = "0x000000000000000000000000000000000000dEaD"

    elif kind == AttackKind.BAD_SELECTOR:
        decision = Decision(
            action=TradeAction.BUY,
            token_in=token_in,
            token_out=token_out,
            amount_in=100_000_000_000_000_000,
            min_amount_out=90_000_000_000_000_000,
            rationale="RED-TEAM ATTACK: Calling disallowed function selector 0xdeadbeef.",
            confidence=1.0,
        )
        calldata_override = bytes.fromhex("deadbeef") + b"\x00" * 32

    # BYPASS GUARDRAILS DIRECTLY -> call onchain contract
    result = executor.execute_trade(
        user=req.user,
        signals=signals,
        decision=decision,
        target_override=target_override,
        calldata_override=calldata_override,
    )

    await broadcast_ws(
        {
            "type": "attack",
            "kind": kind.value,
            "decision": decision.model_dump(),
            "guardrails_bypassed": True,
            "result": result.model_dump(),
        }
    )
    return result


@router.websocket("/stream")
async def websocket_stream(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    try:
        # Send initial status
        await websocket.send_json(
            {
                "type": "connected",
                "agent_address": guard_client.agent_address,
                "chain_id": settings.chain_id,
            }
        )
        while True:
            # Keepalive / ping
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.discard(websocket)
    except Exception:
        active_connections.discard(websocket)

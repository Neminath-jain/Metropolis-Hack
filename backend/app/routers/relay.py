"""
Aegis-Monad Relayer Router
==========================
Testnet-only gas sponsorship relayer for passkey-authenticated users.

Security & Threat Model:
-----------------------
1. NON-CUSTODIAL & ZERO KEY ACCESS:
   - The relayer NEVER accepts, receives, or stores any user private keys.
   - All delegated actions are cryptographically signed on the user's client device
     via hardware-backed WebAuthn P-256 authenticators (TouchID, FaceID, YubiKey).
   - Because the challenge hash binds (chainId, guardAddress, userId, payloadHash, nonce, deadline),
     the relayer cannot forge or alter transaction parameters.
   - The relayer CANNOT move user funds on its own.

2. STRICT ALLOWED SELECTOR & TARGET WHITELIST:
   - Target MUST be the verified AgentGuard contract.
   - Only the following functions can ever be relayed:
     * registerPasskey(uint256,uint256) -> 0x3b3220f4
     * registerSessionWithPasskey(...) -> 0xc1a46382
     * revokeSessionWithPasskey(...) -> 0x4b89a55a
     * withdrawWithPasskey(...) -> 0x03d38aa9

3. MONAD GAS PRICING & LIMIT ARCHITECTURE:
   - Monad consensus executes asynchronously and charges tx fees based on the specified
     GAS LIMIT, NOT gas used.
   - The relayer strictly computes gas limit = int(estimate_gas * 1.10) (10% buffer)
     subject to a hard cap (RELAYER_GAS_CAP = 1,000,000). Fixed or inflated limits
     are strictly prohibited.

4. RATE LIMITING & DAILY SPEND PROTECTION:
   - Rate limits enforced per client IP and per userId.
   - Daily gas spend cap protects the relayer account from drain attacks.
"""

import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
from threading import Lock
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Request, status
from eth_account import Account
from web3 import Web3
from app.config import settings

router = APIRouter(prefix="/relay", tags=["Relayer"])

# Allowed 4-byte selectors on AgentGuard
ALLOWED_SELECTORS: Dict[str, str] = {
    "0x3b3220f4": "registerPasskey(uint256,uint256)",
    "0xc1a46382": "registerSessionWithPasskey(address,address,uint256,uint64,((address,uint128,uint128)[],address[],(address,bytes4,bool)[],(address,address,uint256)[]),uint256,uint256,(bytes,string,uint256,uint256,bytes32,bytes32))",
    "0x4b89a55a": "revokeSessionWithPasskey(address,address,uint256,uint256,(bytes,string,uint256,uint256,bytes32,bytes32))",
    "0x03d38aa9": "withdrawWithPasskey(address,address,uint256,address,uint256,uint256,(bytes,string,uint256,uint256,bytes32,bytes32))",
}


class RelayRequest(BaseModel):
    target: str = Field(..., description="Target contract address (must be AgentGuard)")
    data: str = Field(..., description="ABI-encoded calldata with allowed function selector")
    user_id: Optional[str] = Field(None, description="Optional passkey userId for rate-limiting")


class RelayResponse(BaseModel):
    status: str
    tx_hash: str
    gas_limit: int
    explorer_url: str
    function_name: str


class RelayerManager:
    def __init__(self):
        self.lock = Lock()
        self.ip_timestamps: Dict[str, List[float]] = {}
        self.user_timestamps: Dict[str, List[float]] = {}
        self.current_day: str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.daily_spent_wei: int = 0

    def check_rate_limit(self, ip: str, user_id: Optional[str]):
        now = time.time()
        window = 60.0  # 1 minute window
        max_requests_per_window = 20

        with self.lock:
            # IP check
            ip_times = [t for t in self.ip_timestamps.get(ip, []) if now - t < window]
            if len(ip_times) >= max_requests_per_window:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded for IP. Maximum {max_requests_per_window} requests per minute.",
                )
            ip_times.append(now)
            self.ip_timestamps[ip] = ip_times

            # User check
            if user_id:
                uid_clean = user_id.lower()
                user_times = [t for t in self.user_timestamps.get(uid_clean, []) if now - t < window]
                if len(user_times) >= max_requests_per_window:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail=f"Rate limit exceeded for user. Maximum {max_requests_per_window} requests per minute.",
                    )
                user_times.append(now)
                self.user_timestamps[uid_clean] = user_times

    def check_and_add_spend(self, estimated_cost_wei: int):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        cap_wei = int(settings.daily_spend_cap_mon * 10**18)

        with self.lock:
            if today != self.current_day:
                self.current_day = today
                self.daily_spent_wei = 0

            if self.daily_spent_wei + estimated_cost_wei > cap_wei:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Daily relayer gas spend cap reached ({settings.daily_spend_cap_mon} MON). Try again tomorrow.",
                )
            self.daily_spent_wei += estimated_cost_wei


relayer_manager = RelayerManager()


def extract_user_id(selector: str, calldata: str) -> Optional[str]:
    """Extracts userId or user from calldata for rate limiting if present."""
    try:
        clean_hex = calldata.replace("0x", "")
        # For functions with user/userId as first parameter (starts at byte 4, len 32 bytes)
        if selector in ("0x77659edf", "0x756b7f50", "0x1e903de6", "0xb3db428b"):
            if len(clean_hex) >= 8 + 64:
                addr_slice = clean_hex[8 + 24 : 8 + 64]
                return Web3.to_checksum_address("0x" + addr_slice)
    except Exception:
        pass
    return None


@router.post("", response_model=RelayResponse)
async def submit_relay(req: RelayRequest, request: Request):
    # 1. Rate Limiting by IP first
    client_ip = request.client.host if request.client else "testclient"
    relayer_manager.check_rate_limit(client_ip, None)

    # 2. Validate Target Contract
    if req.target.lower() != settings.agent_guard_address.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Disallowed target address {req.target}. Relayer only forwards to AgentGuard ({settings.agent_guard_address}).",
        )

    # 3. Validate Selector
    calldata_str = req.data if req.data.startswith("0x") else "0x" + req.data
    if len(calldata_str) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid calldata length. Missing 4-byte function selector.",
        )

    selector = calldata_str[:10].lower()
    if selector not in ALLOWED_SELECTORS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Disallowed function selector {selector}. Relayer only forwards registerPasskey, registerSessionWithPasskey, revokeSessionWithPasskey, and withdrawWithPasskey calls.",
        )

    fn_name = ALLOWED_SELECTORS[selector].split("(")[0]

    # 4. Rate Limiting by userId if present
    detected_user = req.user_id or extract_user_id(selector, calldata_str)
    if detected_user:
        relayer_manager.check_rate_limit(client_ip, detected_user)


    # 4. Check Relayer Key Configuration
    if not settings.relayer_private_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Relayer private key is not configured on server.",
        )

    relayer_acc = Account.from_key(settings.relayer_private_key)
    w3 = Web3(Web3.HTTPProvider(settings.monad_rpc_url))
    if not w3.is_connected():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Monad testnet RPC unreachable.",
        )

    # 5. Estimate Gas with 10% Margin and Cap
    target_addr = Web3.to_checksum_address(req.target)
    try:
        est_gas = w3.eth.estimate_gas({
            "from": relayer_acc.address,
            "to": target_addr,
            "data": calldata_str,
        })
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transaction simulation failed during gas estimation: {str(e)}",
        )

    # Monad charges gas LIMIT, never gas used! Strict 10% margin + hard cap:
    gas_limit = int(est_gas * 1.10)
    if gas_limit > settings.relayer_gas_cap:
        gas_limit = settings.relayer_gas_cap

    gas_price = w3.eth.gas_price
    estimated_cost = gas_limit * gas_price

    # 6. Check Daily Spend Cap
    relayer_manager.check_and_add_spend(estimated_cost)

    # 7. Build and Sign Transaction
    try:
        with relayer_manager.lock:
            nonce = w3.eth.get_transaction_count(relayer_acc.address, "pending")
            tx = {
                "to": target_addr,
                "data": calldata_str,
                "value": 0,
                "gas": gas_limit,
                "gasPrice": gas_price,
                "nonce": nonce,
                "chainId": settings.chain_id,
            }
            signed_tx = w3.eth.account.sign_transaction(tx, relayer_acc.key)
            tx_hash_bytes = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            tx_hash = tx_hash_bytes.hex()
            if not tx_hash.startswith("0x"):
                tx_hash = "0x" + tx_hash

        explorer_url = f"{settings.explorer_base_url}/tx/{tx_hash}"

        return RelayResponse(
            status="submitted",
            tx_hash=tx_hash,
            gas_limit=gas_limit,
            explorer_url=explorer_url,
            function_name=fn_name,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Relayer broadcast failed: {str(e)}",
        )

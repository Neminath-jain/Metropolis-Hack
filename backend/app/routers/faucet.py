"""
Aegis-Monad Testnet Faucet Router
=================================
Mints mock testnet tokens (mWMON) directly into the user's AgentGuard vault
via the depositFor() primitive for instant zero-gas onboarding.

Notice:
------
All assets minted by this endpoint are DEMO / MOCK TESTNET tokens on Monad Testnet.
They carry no real financial value and exist exclusively for testing delegation policies.
"""

import time
from typing import Dict, List, Optional
from threading import Lock
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Request, status
from eth_account import Account
from web3 import Web3
from app.config import settings
from app.routers.relay import relayer_manager

router = APIRouter(prefix="/faucet", tags=["Faucet"])

# Minimal ERC20 ABI for mint, allowance, and approve
MOCK_ERC20_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
        ],
        "name": "mint",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "owner", "type": "address"},
            {"internalType": "address", "name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "spender", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

# Minimal AgentGuard ABI for depositFor
AGENT_GUARD_DEPOSIT_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "user", "type": "address"},
            {"internalType": "address", "name": "token", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
        ],
        "name": "depositFor",
        "outputs": [{"internalType": "uint256", "name": "received", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]


class FaucetRequest(BaseModel):
    user: str = Field(..., description="Recipient user or passkey address to credit in vault")
    token: Optional[str] = Field(None, description="Optional token address (defaults to mWMON)")
    amount: Optional[int] = Field(None, description="Optional amount in wei (defaults to 10 mWMON)")


class FaucetResponse(BaseModel):
    status: str
    user: str
    token: str
    token_symbol: str
    amount_wei: str
    amount_formatted: str
    tx_hash: str
    explorer_url: str
    is_mock: bool = True
    note: str


class FaucetRateLimiter:
    def __init__(self):
        self.lock = Lock()
        self.ip_timestamps: Dict[str, List[float]] = {}
        self.user_timestamps: Dict[str, List[float]] = {}

    def check_rate_limit(self, ip: str, user: str):
        now = time.time()
        window = 30.0  # 30 seconds cooldown
        max_requests = 2

        with self.lock:
            # IP limit
            ip_times = [t for t in self.ip_timestamps.get(ip, []) if now - t < window]
            if len(ip_times) >= max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Faucet rate limit exceeded for your IP. Please wait 30 seconds before claiming again.",
                )
            ip_times.append(now)
            self.ip_timestamps[ip] = ip_times

            # User address limit
            u_clean = user.lower()
            user_times = [t for t in self.user_timestamps.get(u_clean, []) if now - t < window]
            if len(user_times) >= max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Faucet rate limit exceeded for account {user}. Please wait 30 seconds before claiming again.",
                )
            user_times.append(now)
            self.user_timestamps[u_clean] = user_times


faucet_limiter = FaucetRateLimiter()


@router.post("", response_model=FaucetResponse)
async def request_faucet(req: FaucetRequest, request: Request):
    if not Web3.is_address(req.user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid Ethereum address: {req.user}",
        )

    user_addr = Web3.to_checksum_address(req.user)
    client_ip = request.client.host if request.client else "unknown"
    faucet_limiter.check_rate_limit(client_ip, user_addr)

    # Defaults: tokenA (mWMON) and 10 tokens (10 * 10^18)
    token_addr = Web3.to_checksum_address(req.token or settings.token_a_address)
    amount_wei = req.amount or 10 * 10**18
    guard_addr = Web3.to_checksum_address(settings.agent_guard_address)

    if not settings.relayer_private_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Relayer/Faucet private key is not configured.",
        )

    w3 = Web3(Web3.HTTPProvider(settings.monad_rpc_url))
    if not w3.is_connected():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Monad testnet RPC unreachable.",
        )

    relayer_acc = Account.from_key(settings.relayer_private_key)

    token_contract = w3.eth.contract(address=token_addr, abi=MOCK_ERC20_ABI)
    guard_contract = w3.eth.contract(address=guard_addr, abi=AGENT_GUARD_DEPOSIT_ABI)

    with relayer_manager.lock:
        for attempt in range(2):
            try:
                # 1. Mint mock tokens to relayer
                nonce = w3.eth.get_transaction_count(relayer_acc.address, "pending")
                gas_price = int(w3.eth.gas_price * (1.15 if attempt > 0 else 1.05))

                # Step A: Mint
                mint_fn = token_contract.functions.mint(relayer_acc.address, amount_wei)
                est_gas_mint = mint_fn.estimate_gas({"from": relayer_acc.address})
                gas_limit_mint = min(int(est_gas_mint * 1.10), settings.relayer_gas_cap)

                tx_mint = mint_fn.build_transaction({
                    "from": relayer_acc.address,
                    "nonce": nonce,
                    "gas": gas_limit_mint,
                    "gasPrice": gas_price,
                    "chainId": settings.chain_id,
                })
                signed_mint = w3.eth.account.sign_transaction(tx_mint, relayer_acc.key)
                mint_hash = w3.eth.send_raw_transaction(signed_mint.raw_transaction)
                w3.eth.wait_for_transaction_receipt(mint_hash, timeout=30)

                # Step B: Approve if necessary
                current_allowance = token_contract.functions.allowance(relayer_acc.address, guard_addr).call()
                if current_allowance < amount_wei:
                    nonce += 1
                    approve_fn = token_contract.functions.approve(guard_addr, 2**256 - 1)
                    est_gas_app = approve_fn.estimate_gas({"from": relayer_acc.address})
                    gas_limit_app = min(int(est_gas_app * 1.10), settings.relayer_gas_cap)

                    tx_app = approve_fn.build_transaction({
                        "from": relayer_acc.address,
                        "nonce": nonce,
                        "gas": gas_limit_app,
                        "gasPrice": gas_price,
                        "chainId": settings.chain_id,
                    })
                    signed_app = w3.eth.account.sign_transaction(tx_app, relayer_acc.key)
                    app_hash = w3.eth.send_raw_transaction(signed_app.raw_transaction)
                    w3.eth.wait_for_transaction_receipt(app_hash, timeout=30)
                    nonce += 1
                else:
                    nonce += 1

                # Step C: DepositFor into User's Vault in AgentGuard
                deposit_fn = guard_contract.functions.depositFor(user_addr, token_addr, amount_wei)
                est_gas_dep = deposit_fn.estimate_gas({"from": relayer_acc.address})
                gas_limit_dep = min(int(est_gas_dep * 1.10), settings.relayer_gas_cap)

                tx_dep = deposit_fn.build_transaction({
                    "from": relayer_acc.address,
                    "nonce": nonce,
                    "gas": gas_limit_dep,
                    "gasPrice": gas_price,
                    "chainId": settings.chain_id,
                })
                signed_dep = w3.eth.account.sign_transaction(tx_dep, relayer_acc.key)
                dep_hash = w3.eth.send_raw_transaction(signed_dep.raw_transaction)
                dep_receipt = w3.eth.wait_for_transaction_receipt(dep_hash, timeout=30)

                tx_hash_str = dep_receipt.transactionHash.hex()
                if not tx_hash_str.startswith("0x"):
                    tx_hash_str = "0x" + tx_hash_str

                symbol = "mWMON" if token_addr.lower() == settings.token_a_address.lower() else "mUSDT"
                amount_human = f"{amount_wei / 10**18:.2f} {symbol}"

                return FaucetResponse(
                    status="success",
                    user=user_addr,
                    token=token_addr,
                    token_symbol=symbol,
                    amount_wei=str(amount_wei),
                    amount_formatted=amount_human,
                    tx_hash=tx_hash_str,
                    explorer_url=f"{settings.explorer_base_url}/tx/{tx_hash_str}",
                    is_mock=True,
                    note="Testnet mock tokens successfully credited directly to vault via depositFor()",
                )
            except Exception as e:
                err_str = str(e)
                if ("higher priority" in err_str or "nonce too low" in err_str or "already known" in err_str) and attempt == 0:
                    time.sleep(2.0)
                    continue
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Faucet funding failed: {err_str}",
                )

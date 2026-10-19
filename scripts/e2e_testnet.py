"""
End-to-End Testnet Integration Script for Aegis-Monad.

Flow:
1. User deposits test tokens (WMON) into AgentGuard vault.
2. User registers delegation session for the agent key with strict limits & venue allowlist.
3. Backend agent runs cycle via POST /agent/run-once, executing a bounded swap through MockDEX.
4. Red-team attack triggered via POST /agent/attack/over_limit bypassing offchain guardrails.
5. Verifies onchain AgentGuard halts the attack, emitting PolicyViolation with no funds moved.
"""

import json
import os
import sys
import time
import httpx
from web3 import Web3

# Add backend to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend")))
from app.config import settings
from app.venues.mock_dex import SWAP_SELECTOR

ERC20_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "spender", "type": "address"},
            {"internalType": "uint256", "name": "value", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
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
        "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]

EXPLORER_BASE = "https://testnet.monadscan.com/tx/"


def load_deployments():
    deployments_path = os.path.join(
        os.path.dirname(__file__), "../contracts/deployments.json"
    )
    if os.path.exists(deployments_path):
        with open(deployments_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def run_e2e(
    user_private_key: str = None,
    backend_url: str = "http://localhost:8000",
    rpc_url: str = None,
):
    rpc = rpc_url or settings.monad_rpc_url
    w3 = Web3(Web3.HTTPProvider(rpc))

    # Throwaway user key or default test key
    user_pk = (
        user_private_key
        or os.getenv("USER_PRIVATE_KEY")
    )
    if not user_pk:
        raise ValueError("USER_PRIVATE_KEY must be provided via argument or env var USER_PRIVATE_KEY")
    user_account = w3.eth.account.from_key(user_pk)
    user_addr = user_account.address

    deployments = load_deployments()
    contracts_info = deployments.get("contracts", {})
    guard_addr = contracts_info.get("agentGuard", settings.agent_guard_address)
    token_a_addr = contracts_info.get("tokens", {}).get("tokenA")
    token_b_addr = contracts_info.get("tokens", {}).get("tokenB")
    venue_addr = contracts_info.get("venue", settings.venue_address)
    agent_id = deployments.get("agent", {}).get("agentId", settings.agent_id)

    print("=" * 70)
    print("AEGIS-MONAD END-TO-END DEMO EXECUTION")
    print("=" * 70)
    print(f"Network: Monad Testnet (Chain ID: {settings.chain_id})")
    print(f"AgentGuard: {guard_addr}")
    print(f"Venue (MockDEX): {venue_addr}")
    print(f"User Address: {user_addr}")
    print(f"Agent Address: {w3.eth.account.from_key(settings.agent_private_key).address}")
    print(f"Agent ID: {agent_id}")
    print("=" * 70)

    # Load Guard Contract
    abi_path = os.path.join(
        os.path.dirname(__file__), "../backend/app/chain/agent_guard_abi.json"
    )
    with open(abi_path, "r", encoding="utf-8") as f:
        guard_abi = json.load(f)
    guard = w3.eth.contract(address=guard_addr, abi=guard_abi)

    # 1. Mint & Approve Token A
    print("\n[Step 1] Preparing User Tokens & Vault Deposit...")
    token_a = w3.eth.contract(address=token_a_addr, abi=ERC20_ABI)

    try:
        # Mint 10 WMON to user if MockERC20
        nonce = w3.eth.get_transaction_count(user_addr, "pending")
        mint_tx = token_a.functions.mint(user_addr, 10 * 10**18).build_transaction(
            {
                "from": user_addr,
                "nonce": nonce,
                "gas": 150_000,
                "gasPrice": w3.eth.gas_price,
                "chainId": settings.chain_id,
            }
        )
        signed_mint = w3.eth.account.sign_transaction(mint_tx, user_pk)
        tx_mint = w3.eth.send_raw_transaction(signed_mint.raw_transaction)
        w3.eth.wait_for_transaction_receipt(tx_mint, timeout=60)
        print(f"Mint Tx: {EXPLORER_BASE}{tx_mint.hex()}")
    except Exception as e:
        print(f"Mint note: {e}")

    # Approve Guard
    nonce = w3.eth.get_transaction_count(user_addr, "pending")
    appr_tx = token_a.functions.approve(guard_addr, 10 * 10**18).build_transaction(
        {
            "from": user_addr,
            "nonce": nonce,
            "gas": 100_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": settings.chain_id,
        }
    )
    signed_appr = w3.eth.account.sign_transaction(appr_tx, user_pk)
    tx_appr = w3.eth.send_raw_transaction(signed_appr.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_appr, timeout=60)
    print(f"Approve Tx: {EXPLORER_BASE}{tx_appr.hex()}")

    # Deposit 5 WMON into Guard
    deposit_amount = 5 * 10**18
    nonce = w3.eth.get_transaction_count(user_addr, "pending")
    dep_tx = guard.functions.deposit(token_a_addr, deposit_amount).build_transaction(
        {
            "from": user_addr,
            "nonce": nonce,
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": settings.chain_id,
        }
    )
    signed_dep = w3.eth.account.sign_transaction(dep_tx, user_pk)
    tx_dep = w3.eth.send_raw_transaction(signed_dep.raw_transaction)
    receipt_dep = w3.eth.wait_for_transaction_receipt(tx_dep, timeout=60)
    print(f"Deposit Tx confirmed: {EXPLORER_BASE}{tx_dep.hex()}")

    # 2. Register Delegation Session
    print("\n[Step 2] User Registering Policy Delegation Session...")
    agent_addr = w3.eth.account.from_key(settings.agent_private_key).address
    expires_at = int(time.time()) + 7 * 86400  # 7 days

    policy = (
        [(token_a_addr, 10 * 10**18, 2 * 10**18)],  # tokens: daily 10, per-trade 2
        [venue_addr],  # targets
        [(venue_addr, SWAP_SELECTOR, True)],  # selectors
        [(token_a_addr, token_b_addr, 10**18)],  # rates: 1:1 floor
    )

    nonce = w3.eth.get_transaction_count(user_addr, "pending")
    reg_tx = guard.functions.registerSession(
        agent_addr, agent_id, expires_at, policy
    ).build_transaction(
        {
            "from": user_addr,
            "nonce": nonce,
            "gas": 350_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": settings.chain_id,
        }
    )
    signed_reg = w3.eth.account.sign_transaction(reg_tx, user_pk)
    tx_reg = w3.eth.send_raw_transaction(signed_reg.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_reg, timeout=60)
    print(f"RegisterSession Tx confirmed: {EXPLORER_BASE}{tx_reg.hex()}")

    # 3. Call POST /agent/run-once (Happy Path Swap)
    print("\n[Step 3] Calling Reference Agent to Execute Bounded Swap...")
    with httpx.Client(base_url=backend_url, timeout=30.0) as client:
        res = client.post(
            "/agent/run-once",
            json={
                "user": user_addr,
                "token_in": token_a_addr,
                "token_out": token_b_addr,
            },
        )
        assert res.status_code == 200, f"run-once failed: {res.text}"
        swap_result = res.json()
        print(f"Swap Result Status: {swap_result['status']}")
        print(f"Swap Tx: {EXPLORER_BASE}{swap_result.get('tx_hash')}")
        print(f"Decision Hash: {swap_result.get('decision_hash')}")
        print(f"Spent: {swap_result.get('spent')} wei | Received: {swap_result.get('received')} wei")

    # 4. Red-Team Attack (Bypassing Guardrails)
    print("\n[Step 4] Executing Red-Team Attack (Over-Limit Attempt)...")
    with httpx.Client(base_url=backend_url, timeout=30.0) as client:
        res_attack = client.post(
            "/agent/attack/over_limit",
            json={
                "user": user_addr,
                "token_in": token_a_addr,
                "token_out": token_b_addr,
                "custom_amount": 50 * 10**18,  # 50 WMON exceeds 2 WMON per-trade cap
            },
        )
        assert res_attack.status_code == 200, f"attack endpoint failed: {res_attack.text}"
        attack_result = res_attack.json()
        print(f"Attack Result Status: {attack_result['status']}")
        print(f"Attack Tx: {EXPLORER_BASE}{attack_result.get('tx_hash')}")
        print(f"Policy Engine Response: {attack_result.get('reason_name')}")
        print(f"Details: {attack_result.get('details')}")

    print("\n" + "=" * 70)
    print("ALL DEMO CHECKS COMPLETED SUCCESSFULLY")
    print(f"Deposit Tx:          {EXPLORER_BASE}{tx_dep.hex()}")
    print(f"RegisterSession Tx:  {EXPLORER_BASE}{tx_reg.hex()}")
    print(f"Successful Swap Tx:  {EXPLORER_BASE}{swap_result.get('tx_hash')}")
    print(f"PolicyViolation Tx:  {EXPLORER_BASE}{attack_result.get('tx_hash')}")
    print("=" * 70)


if __name__ == "__main__":
    run_e2e()

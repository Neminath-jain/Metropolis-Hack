"""
Aegis-Monad Python Agent Integration Example
Demonstrates how an autonomous AI backend (e.g. FastAPI service, LangChain agent, or autonomous bot)
integrates with Aegis-Monad using web3.py to:
1. Verify its onchain session and spending limits before executing trades.
2. Build authorized call data for a target DEX.
3. Submit AgentGuard.execute() within bounded limits.
"""

import json
import os
import sys
import time
from pathlib import Path
from web3 import Web3
from eth_abi import encode

# 1. Configuration and Paths
ROOT_DIR = Path(__file__).resolve().parent.parent
DEPLOYMENTS_PATH = ROOT_DIR / "contracts" / "deployments.json"
GUARD_ARTIFACT_PATH = ROOT_DIR / "contracts" / "out" / "AgentGuard.sol" / "AgentGuard.json"

if not DEPLOYMENTS_PATH.exists():
    print(f"Error: {DEPLOYMENTS_PATH} not found.")
    sys.exit(1)

with open(DEPLOYMENTS_PATH, "r") as f:
    deployments = json.load(f)

with open(GUARD_ARTIFACT_PATH, "r") as f:
    guard_artifact = json.load(f)

RPC_URL = os.getenv("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz")
EXPLORER_BASE = "https://testnet.monadscan.com/tx/"
CHAIN_ID = deployments.get("chainId", 10143)

w3 = Web3(Web3.HTTPProvider(RPC_URL))
if not w3.is_connected():
    print(f"Error: Unable to connect to Monad RPC at {RPC_URL}")
    sys.exit(1)

# Contracts
guard_address = Web3.to_checksum_address(deployments["contracts"]["agentGuard"])
venue_address = Web3.to_checksum_address(deployments["contracts"]["venue"])
token_a = Web3.to_checksum_address(deployments["contracts"]["tokens"]["tokenA"])
token_b = Web3.to_checksum_address(deployments["contracts"]["tokens"]["tokenB"])
guard_contract = w3.eth.contract(address=guard_address, abi=guard_artifact["abi"])

# Agent Account (read from env, never hardcoded)
agent_private_key = os.getenv("AGENT_PRIVATE_KEY")
if not agent_private_key:
    # Try reading from backend/.env or contracts/.env
    for candidate in [ROOT_DIR / "backend" / ".env", ROOT_DIR / "contracts" / ".env"]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if line.startswith("AGENT_PRIVATE_KEY="):
                    agent_private_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        if agent_private_key:
            break

if not agent_private_key:
    print("Notice: AGENT_PRIVATE_KEY not provided. Demonstrating read-only simulation mode.")
    agent_address = Web3.to_checksum_address(deployments["agent"]["address"])
    agent_account = None
else:
    if not agent_private_key.startswith("0x"):
        agent_private_key = "0x" + agent_private_key
    agent_account = w3.eth.account.from_key(agent_private_key)
    agent_address = agent_account.address

# Target User Address to trade on behalf of
user_address = Web3.to_checksum_address("0x91DD9d96344f000b5175a45589239dd658E4350d")


def main():
    print("=" * 68)
    print("AEGIS-MONAD: PYTHON AGENT INTEGRATION (web3.py)")
    print("=" * 68)
    print(f"Agent Address: {agent_address}")
    print(f"User Address:  {user_address}")
    print(f"AgentGuard:    {guard_address}")
    print(f"Target Venue:  {venue_address}")
    print("=" * 68)

    # -------------------------------------------------------------------------
    # STEP 1: Verify Delegation Session Onchain
    # -------------------------------------------------------------------------
    print("\n[Step 1] Querying AgentGuard session state...")
    session_info = guard_contract.functions.getSession(user_address, agent_address).call()
    is_active = session_info[0]
    expires_at = session_info[1]
    agent_id = session_info[2]

    current_time = int(time.time())
    print(f"  Session Active: {is_active}")
    print(f"  Agent ID:       {agent_id}")
    print(f"  Expires In:     {max(0, expires_at - current_time)} seconds")

    if not is_active or expires_at <= current_time:
        print("  Session is inactive or expired. Agent cannot execute trades.")
        return

    # -------------------------------------------------------------------------
    # STEP 2: Check Remaining Spending Budget & Balance
    # -------------------------------------------------------------------------
    print("\n[Step 2] Checking user vault balance and rolling window budget...")
    user_vault_bal = guard_contract.functions.balances(user_address, token_a).call()
    limit_info = guard_contract.functions.getLimit(user_address, agent_address, token_a).call()
    window_info = guard_contract.functions.windowRemaining(user_address, agent_address, token_a).call()

    daily_limit = limit_info[0]
    per_trade_limit = limit_info[1]
    spent_in_window = limit_info[2]
    remaining_budget = window_info[0]

    print(f"  Vault Balance:    {user_vault_bal / 1e18:.4f} mWMON")
    print(f"  Per-Trade Limit:  {per_trade_limit / 1e18:.4f} mWMON")
    print(f"  Daily Limit:      {daily_limit / 1e18:.4f} mWMON")
    print(f"  Spent in 24h:     {spent_in_window / 1e18:.4f} mWMON")
    print(f"  Remaining 24h:    {remaining_budget / 1e18:.4f} mWMON")

    # Trade sizing: trade 0.05 WMON (well below perTrade limit of 2.0 WMON)
    trade_amount = int(0.05 * 10**18)

    if user_vault_bal < trade_amount:
        print(f"  User vault balance insufficient ({user_vault_bal} < {trade_amount})")
        return
    if trade_amount > per_trade_limit:
        print(f"  Trade amount exceeds per-trade limit ({trade_amount} > {per_trade_limit})")
        return
    if trade_amount > remaining_budget:
        print(f"  Trade amount exceeds remaining daily budget ({trade_amount} > {remaining_budget})")
        return

    # -------------------------------------------------------------------------
    # STEP 3: Formulate Venue Calldata & Slippage Protection
    # -------------------------------------------------------------------------
    print("\n[Step 3] Formulating DEX swap calldata...")
    # Canonical venue swap selector loaded from deployments.json
    venue_swap_hex = deployments["contracts"]["venueSelectors"]["swap"]
    swap_selector = bytes.fromhex(venue_swap_hex[2:] if venue_swap_hex.startswith("0x") else venue_swap_hex)
    min_amount_out = int(trade_amount * 0.98) # 2% slippage tolerance

    swap_data = swap_selector + encode(
        ["address", "uint256", "address", "uint256"],
        [token_a, trade_amount, token_b, min_amount_out]
    )

    execute_params = (
        user_address,     # user
        token_a,          # tokenIn
        trade_amount,     # amountIn
        token_b,          # tokenOut
        min_amount_out,   # minAmountOut
        venue_address,    # target
        swap_data,        # data
        b"\x00" * 32      # decisionHash
    )

    # -------------------------------------------------------------------------
    # STEP 4: Execute Trade on AgentGuard
    # -------------------------------------------------------------------------
    print("\n[Step 4] Submitting AgentGuard.execute()...")
    if not agent_account:
        print("  [Simulation Mode] Simulating call via eth_call...")
        try:
            success = guard_contract.functions.execute(execute_params).call({"from": agent_address})
            print(f"  Simulation Result: {success}")
            if success:
                print("  Trade passes onchain policy validation! Ready for live execution.")
        except Exception as e:
            print(f"  Simulation reverted: {e}")
        return

    # Live transaction submission
    nonce = w3.eth.get_transaction_count(agent_account.address, "pending")
    gas_price = w3.eth.gas_price

    # On Monad, fees are charged on gas_limit (not gas_used). Keep safety margin tight at 10%.
    try:
        est_gas = guard_contract.functions.execute(execute_params).estimate_gas({"from": agent_account.address})
        gas_limit = int(est_gas * 1.10)
        print(f"  Estimated execution gas: {est_gas:,} (tx gas limit set to {gas_limit:,} with 10% Monad margin)")
    except Exception as e:
        gas_limit = 310000
        print(f"  Gas estimation fallback (default {gas_limit:,}): {e}")

    tx = guard_contract.functions.execute(execute_params).build_transaction({
        "from": agent_account.address,
        "nonce": nonce,
        "gas": gas_limit,
        "gasPrice": gas_price,
        "chainId": CHAIN_ID,
    })

    signed_tx = agent_account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
    tx_hash_hex = tx_hash.hex()
    if not tx_hash_hex.startswith("0x"):
        tx_hash_hex = "0x" + tx_hash_hex
    print(f"  Submitted Transaction: {EXPLORER_BASE}{tx_hash_hex}")

    print("  Waiting for receipt...")
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    if receipt.status == 1:
        print("  EXECUTION SUCCESSFUL!")
        print(f"  Mined in block {receipt.blockNumber}, gasUsed (from receipt): {receipt.gasUsed:,} (tx gas limit: {gas_limit:,})")
    else:
        print("  EXECUTION FAILED onchain.")


if __name__ == "__main__":
    main()

"""
Stage 1 Runner: Full Phase 2 deploy + end-to-end demo on local Anvil fork of Monad testnet.
"""

import json
import os
import subprocess
import sys
import time
import httpx
from eth_account import Account
from web3 import Web3

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend")))
from app.venues.mock_dex import SWAP_SELECTOR

DEPLOYER_KEY = os.getenv("STAGE1_DEPLOYER_KEY") or os.getenv("DEPLOYER_KEY")
AGENT_KEY    = os.getenv("STAGE1_AGENT_KEY") or os.getenv("AGENT_PRIVATE_KEY")
USER_KEY     = os.getenv("STAGE1_USER_KEY") or os.getenv("USER_PRIVATE_KEY")

RPC_URL = "http://127.0.0.1:8545"
CHAIN_ID = 10143
ERC8004_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e"
EXPLORER_BASE = "https://testnet.monadscan.com/tx/"

ERC20_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "spender", "type": "address"},
            {"internalType": "uint256", "name": "value", "type": "uint256"}
        ],
        "name": "approve",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "mint",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
]

ERC8004_ABI = [
    {
        "inputs": [{"internalType": "string", "name": "uri", "type": "string"}],
        "name": "register",
        "outputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
        "name": "ownerOf",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "from", "type": "address"},
            {"indexed": True, "internalType": "address", "name": "to", "type": "address"},
            {"indexed": True, "internalType": "uint256", "name": "tokenId", "type": "uint256"}
        ],
        "name": "Transfer",
        "type": "event"
    }
]


def ensure_anvil():
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if w3.is_connected():
        print(f"[Anvil] Connected to already running instance at {RPC_URL} (Chain ID: {w3.eth.chain_id})")
        return None

    print("[Anvil] Starting Anvil Monad fork on port 8545...")
    proc = subprocess.Popen(
        ["anvil", "--fork-url", "https://testnet-rpc.monad.xyz", "--chain-id", "10143", "--port", "8545"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    for _ in range(30):
        time.sleep(1)
        if w3.is_connected():
            print(f"[Anvil] Successfully connected to Anvil fork (Block: {w3.eth.block_number})")
            return proc
    raise RuntimeError("Failed to start Anvil fork.")


def setup_accounts(w3: Web3):
    print("\n[Setup] Pre-funding clean EOA test accounts with 1,000 MON...")
    accs = {
        "Deployer": Account.from_key(DEPLOYER_KEY).address,
        "Agent":    Account.from_key(AGENT_KEY).address,
        "User":     Account.from_key(USER_KEY).address
    }
    for role, addr in accs.items():
        w3.provider.make_request("anvil_setCode", [addr, "0x"])
        w3.provider.make_request("anvil_setBalance", [addr, hex(1000 * 10**18)])
        bal = w3.eth.get_balance(addr)
        code_len = len(w3.eth.get_code(addr))
        print(f"  - {role:<8}: {addr} | Balance: {w3.from_wei(bal, 'ether')} MON | Code len: {code_len}")
    return accs


def deploy_contracts(deployer_addr: str):
    print("\n[Deploy] Running Forge deployment script (Deploy.s.sol)...")
    contracts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../contracts"))
    cmd = [
        "forge", "script", "script/Deploy.s.sol",
        "--rpc-url", RPC_URL,
        "--broadcast",
        "--private-key", DEPLOYER_KEY
    ]
    res = subprocess.run(cmd, cwd=contracts_dir, capture_output=True, text=True)
    if res.returncode != 0:
        print("Forge deploy failed:\n", res.stderr)
        sys.exit(1)

    # Parse addresses from run-latest.json
    run_file = os.path.join(contracts_dir, "broadcast/Deploy.s.sol/10143/run-latest.json")
    with open(run_file, "r", encoding="utf-8") as f:
        run_data = json.load(f)

    created = {}
    for tx in run_data.get("transactions", []):
        if tx.get("transactionType") == "CREATE":
            name = tx.get("contractName")
            addr = Web3.to_checksum_address(tx.get("contractAddress"))
            if name == "MockERC20" and "tokenA" not in created:
                created["tokenA"] = addr
            elif name == "MockERC20":
                created["tokenB"] = addr
            else:
                created[name] = addr

    guard_addr = created["AgentGuard"]
    dex_addr = created["MockDEX"]
    token_a = created["tokenA"]
    token_b = created["tokenB"]

    print(f"  - AgentGuard: {guard_addr}")
    print(f"  - MockDEX:    {dex_addr}")
    print(f"  - Token A:    {token_a} (WMON)")
    print(f"  - Token B:    {token_b} (USDT)")

    # Save to deployments.json
    deployments = {
        "chainId": CHAIN_ID,
        "network": "monad_testnet_fork",
        "contracts": {
            "agentGuard": guard_addr,
            "registry": ERC8004_REGISTRY,
            "venue": dex_addr,
            "tokens": {
                "tokenA": token_a,
                "tokenB": token_b
            }
        },
        "agent": {
            "address": Account.from_key(AGENT_KEY).address,
            "agentId": 1
        },
        "deployBlock": run_data.get("receipts", [{}])[0].get("blockNumber", 1),
        "verifiedExplorerUrl": f"https://testnet.monadscan.com/address/{guard_addr}#code"
    }

    dep_path = os.path.join(contracts_dir, "deployments.json")
    with open(dep_path, "w", encoding="utf-8") as f:
        json.dump(deployments, f, indent=2)

    return guard_addr, dex_addr, token_a, token_b


def register_agent(w3: Web3, agent_key: str):
    print("\n[Registry] Registering Agent Identity on ERC-8004 Registry...")
    account = Account.from_key(agent_key)
    agent_addr = account.address

    reg = w3.eth.contract(address=ERC8004_REGISTRY, abi=ERC8004_ABI)
    metadata = {
        "name": "Aegis Reference Trading Agent",
        "description": "Autonomous bounded AI trading agent on Monad Testnet",
        "agentAddress": agent_addr,
        "chainId": CHAIN_ID
    }
    uri = f"data:application/json;utf8,{json.dumps(metadata)}"

    tx = reg.functions.register(uri).build_transaction({
        "from": agent_addr,
        "nonce": w3.eth.get_transaction_count(agent_addr, "pending"),
        "gas": 600_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": CHAIN_ID
    })
    signed = w3.eth.account.sign_transaction(tx, agent_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"  - Registration Tx broadcasted: {EXPLORER_BASE}{tx_hash.hex()}")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    assert receipt["status"] == 1, "Agent registration reverted onchain!"
    events = reg.events.Transfer().process_receipt(receipt)
    agent_id = events[0]["args"]["tokenId"] if events else 1

    owner = reg.functions.ownerOf(agent_id).call()
    print(f"  - Verified onchain Agent ID: {agent_id}")
    print(f"  - Verified ownerOf({agent_id}) = {owner} (matches agent: {owner.lower() == agent_addr.lower()})")
    assert owner.lower() == agent_addr.lower(), "Agent owner mismatch!"

    # Update deployments.json and backend/.env
    dep_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../contracts/deployments.json"))
    with open(dep_path, "r", encoding="utf-8") as f:
        deps = json.load(f)
    deps["agent"] = {
        "address": agent_addr,
        "agentId": agent_id,
        "registrationTx": tx_hash.hex()
    }
    with open(dep_path, "w", encoding="utf-8") as f:
        json.dump(deps, f, indent=2)

    return agent_id, tx_hash.hex()


def update_env(guard_addr: str, venue_addr: str, agent_id: int):
    env_content = f"""MONAD_RPC_URL={RPC_URL}
CHAIN_ID={CHAIN_ID}
AGENT_PRIVATE_KEY={AGENT_KEY}
AGENT_GUARD_ADDRESS={guard_addr}
VENUE_ADDRESS={venue_addr}
AGENT_ID={agent_id}
DEMO_ATTACKS=true
FRONTEND_ORIGIN=http://localhost:5173
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-max
"""
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend/.env"))
    with open(env_path, "w", encoding="utf-8") as f:
        f.write(env_content)
    print("\n[Config] Updated backend/.env with live test parameters.")


def ensure_backend():
    print("\n[Backend] Starting FastAPI reference agent...")
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend"))
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", "8000"],
        cwd=backend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    for _ in range(20):
        time.sleep(1)
        try:
            r = httpx.get("http://127.0.0.1:8000/health", timeout=2.0)
            if r.status_code == 200:
                print(f"  - FastAPI server ready at http://127.0.0.1:8000/docs (Chain ID: {r.json().get('chain_id')})")
                return proc
        except Exception:
            pass
    raise RuntimeError("FastAPI server failed to start.")


def run_e2e_flow(w3: Web3, guard_addr: str, venue_addr: str, token_a_addr: str, token_b_addr: str, agent_id: int):
    print("\n" + "=" * 70)
    print("STARTING END-TO-END DEMONSTRATION")
    print("=" * 70)

    user_addr = Account.from_key(USER_KEY).address
    agent_addr = Account.from_key(AGENT_KEY).address

    abi_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend/app/chain/agent_guard_abi.json"))
    with open(abi_path, "r", encoding="utf-8") as f:
        guard_abi = json.load(f)
    guard = w3.eth.contract(address=guard_addr, abi=guard_abi)
    token_a = w3.eth.contract(address=token_a_addr, abi=ERC20_ABI)
    token_b = w3.eth.contract(address=token_b_addr, abi=ERC20_ABI)

    # 1. Mint 10 WMON to user and approve Guard
    print("\n[Step 1] User Vault Deposit:")
    mint_tx = token_a.functions.mint(user_addr, 10 * 10**18).build_transaction({
        "from": user_addr,
        "nonce": w3.eth.get_transaction_count(user_addr, "pending"),
        "gas": 150_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": CHAIN_ID
    })
    s_mint = w3.eth.account.sign_transaction(mint_tx, USER_KEY)
    w3.eth.send_raw_transaction(s_mint.raw_transaction)

    appr_tx = token_a.functions.approve(guard_addr, 10 * 10**18).build_transaction({
        "from": user_addr,
        "nonce": w3.eth.get_transaction_count(user_addr, "pending"),
        "gas": 100_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": CHAIN_ID
    })
    s_appr = w3.eth.account.sign_transaction(appr_tx, USER_KEY)
    w3.eth.send_raw_transaction(s_appr.raw_transaction)

    # Deposit 5 WMON into AgentGuard
    deposit_amount = 5 * 10**18
    dep_tx = guard.functions.deposit(token_a_addr, deposit_amount).build_transaction({
        "from": user_addr,
        "nonce": w3.eth.get_transaction_count(user_addr, "pending"),
        "gas": 200_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": CHAIN_ID
    })
    s_dep = w3.eth.account.sign_transaction(dep_tx, USER_KEY)
    tx_dep_hash = w3.eth.send_raw_transaction(s_dep.raw_transaction)
    rec_dep = w3.eth.wait_for_transaction_receipt(tx_dep_hash)
    assert rec_dep["status"] == 1, "Vault deposit failed!"
    vault_bal_before = guard.functions.balances(user_addr, token_a_addr).call()
    print(f"  - Deposit Tx:        {EXPLORER_BASE}{tx_dep_hash.hex()} (Block: {rec_dep['blockNumber']})")
    print(f"  - Vault Balance:     {w3.from_wei(vault_bal_before, 'ether')} WMON")

    # 2. Register Delegation Session
    print("\n[Step 2] User Registers Delegation Session:")
    expires_at = int(time.time()) + 7 * 86400
    policy = (
        [(token_a_addr, 10 * 10**18, 2 * 10**18)],  # 10 WMON daily window, 2 WMON per-trade cap
        [venue_addr],                                # MockDEX venue
        [(venue_addr, SWAP_SELECTOR, True)],         # swap(address,uint256,address,uint256)
        [(token_a_addr, token_b_addr, 10**18)]       # 1:1 floor rate
    )
    reg_tx = guard.functions.registerSession(
        agent_addr, agent_id, expires_at, policy
    ).build_transaction({
        "from": user_addr,
        "nonce": w3.eth.get_transaction_count(user_addr, "pending"),
        "gas": 400_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": CHAIN_ID
    })
    s_reg = w3.eth.account.sign_transaction(reg_tx, USER_KEY)
    tx_reg_hash = w3.eth.send_raw_transaction(s_reg.raw_transaction)
    rec_reg = w3.eth.wait_for_transaction_receipt(tx_reg_hash)
    assert rec_reg["status"] == 1, "Session registration failed!"
    print(f"  - RegisterSession Tx: {EXPLORER_BASE}{tx_reg_hash.hex()} (Block: {rec_reg['blockNumber']})")
    print(f"  - Limits Authorized: 2.0 WMON per-trade, 10.0 WMON daily window")

    # 3. Reference Agent Bounded Swap (POST /agent/run-once)
    print("\n[Step 3] Reference Agent Bounded Swap (Happy Path):")
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=30.0) as client:
        res = client.post("/agent/run-once", json={
            "user": user_addr,
            "token_in": token_a_addr,
            "token_out": token_b_addr
        })
        assert res.status_code == 200, f"run-once failed: {res.text}"
        swap_res = res.json()

    print(f"  - Status:            {swap_res['status']}")
    print(f"  - Execute Swap Tx:   {EXPLORER_BASE}{swap_res.get('tx_hash')}")
    print(f"  - Decision Hash:     {swap_res.get('decision_hash')}")
    print(f"  - Tokens Swapped:    {w3.from_wei(int(swap_res.get('spent', 0)), 'ether')} WMON -> {w3.from_wei(int(swap_res.get('received', 0)), 'ether')} USDT")

    vault_wmon = guard.functions.balances(user_addr, token_a_addr).call()
    vault_usdt = guard.functions.balances(user_addr, token_b_addr).call()
    print(f"  - Vault After Swap:  {w3.from_wei(vault_wmon, 'ether')} WMON, {w3.from_wei(vault_usdt, 'ether')} USDT")

    # 4. Red-Team Attack (POST /agent/attack/over_limit)
    print("\n[Step 4] Red-Team Over-Limit Attack (Policy Enforcement):")
    print("  - Attempting 50.0 WMON swap (exceeds authorized 2.0 WMON per-trade cap)...")
    print("  - Bypassing offchain guardrails to force onchain validation...")

    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=30.0) as client:
        res_atk = client.post("/agent/attack/over_limit", json={
            "user": user_addr,
            "token_in": token_a_addr,
            "token_out": token_b_addr,
            "custom_amount": 50 * 10**18
        })
        assert res_atk.status_code == 200, f"attack endpoint failed: {res_atk.text}"
        atk_res = res_atk.json()

    print(f"  - Status:            {atk_res['status']}")
    print(f"  - Policy Violation:  {atk_res.get('reason_name')} (Code: {atk_res.get('reason_code')})")
    print(f"  - Attack Tx Hash:    {EXPLORER_BASE}{atk_res.get('tx_hash')}")
    print(f"  - Exploit Blocked:   {atk_res.get('details')}")

    vault_wmon_after = guard.functions.balances(user_addr, token_a_addr).call()
    vault_usdt_after = guard.functions.balances(user_addr, token_b_addr).call()
    print(f"  - Vault Unchanged:   {w3.from_wei(vault_wmon_after, 'ether')} WMON, {w3.from_wei(vault_usdt_after, 'ether')} USDT")
    assert vault_wmon_after == vault_wmon, "Vault balance was altered during attack!"

    print("\n" + "=" * 70)
    print("STAGE 1 END-TO-END VERIFICATION: 100% PASSED")
    print("=" * 70)
    print(f"1. Vault Deposit Tx:          {EXPLORER_BASE}{tx_dep_hash.hex()}")
    print(f"2. Register Session Tx:       {EXPLORER_BASE}{tx_reg_hash.hex()}")
    print(f"3. Successful Bounded Swap:   {EXPLORER_BASE}{swap_res.get('tx_hash')}")
    print(f"4. Blocked PolicyViolation:   {EXPLORER_BASE}{atk_res.get('tx_hash')}")
    print("=" * 70)


def main():
    anvil_proc = ensure_anvil()
    w3 = Web3(Web3.HTTPProvider(RPC_URL))

    try:
        accs = setup_accounts(w3)
        guard_addr, venue_addr, token_a, token_b = deploy_contracts(accs["Deployer"])
        agent_id, reg_tx = register_agent(w3, AGENT_KEY)
        update_env(guard_addr, venue_addr, agent_id)
        backend_proc = ensure_backend()

        try:
            run_e2e_flow(w3, guard_addr, venue_addr, token_a, token_b, agent_id)
        finally:
            if backend_proc:
                backend_proc.terminate()
    finally:
        if anvil_proc:
            anvil_proc.terminate()


if __name__ == "__main__":
    main()

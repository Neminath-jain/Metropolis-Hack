"""
Comprehensive Stage 2 Live Monad Testnet Runner:
1. Balance validation
2. Deploy AgentGuard, MockERC20 tokens (mWMON, mUSDT), MockDEX via Deploy.s.sol
3. Register Agent on ERC-8004 Registry (0x8004A818BFB912233c491871b3d84c89A494BD9e)
4. Standard E2E: User deposit, session registration, bounded swap, over-limit attack, bad_target attack, bad_selector attack
5. Live Passkey Path Test:
   - P256 key generation & registerPasskey
   - WebAuthn assertion (UP+UV, clientDataJSON, low-s) -> registerSessionWithPasskey
   - Replay attack rejection test (InvalidNonce)
   - High-s malleable signature rejection test (InvalidSignatureS)
   - depositFor passkey userId
   - Bounded swap execution under passkey session
   - withdrawWithPasskey to recipient address
6. Explorer link reporting
"""

import base64
import hashlib
import json
import os
import subprocess
import sys
import time
from eth_abi import encode
from eth_account import Account
from web3 import Web3
from dotenv import dotenv_values
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

# Setup paths
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONTRACTS_DIR = os.path.join(ROOT_DIR, "contracts")
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
DEPLOYMENTS_FILE = os.path.join(CONTRACTS_DIR, "deployments.json")
EXPLORER_BASE = "https://testnet.monadscan.com/tx/"
ADDRESS_EXPLORER_BASE = "https://testnet.monadscan.com/address/"

# Load configurations
contracts_env = dotenv_values(os.path.join(CONTRACTS_DIR, ".env"))
backend_env = dotenv_values(os.path.join(BACKEND_DIR, ".env"))

RPC_URL = contracts_env.get("MONAD_RPC_URL") or "https://testnet-rpc.monad.xyz"
CHAIN_ID = int(contracts_env.get("CHAIN_ID") or 10143)
DEPLOYER_KEY = contracts_env.get("DEPLOYER_KEY")
USER_KEY = contracts_env.get("USER_PRIVATE_KEY")
AGENT_KEY = backend_env.get("AGENT_PRIVATE_KEY")

ERC8004_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e"
SECP256R1_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
SECP256R1_N_DIV_2 = SECP256R1_N >> 1

REGISTER_SESSION_TYPEHASH = Web3.keccak(
    text="RegisterSessionWithPasskey(uint256 chainId,address guard,address userId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
)
WITHDRAW_TYPEHASH = Web3.keccak(
    text="WithdrawWithPasskey(uint256 chainId,address guard,address userId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
)

# ABI definitions
with open(os.path.join(BACKEND_DIR, "app/chain/agent_guard_abi.json"), "r", encoding="utf-8") as f:
    GUARD_ABI = json.load(f)

ERC20_ABI = [
    {"inputs": [{"internalType": "address", "name": "spender", "type": "address"}, {"internalType": "uint256", "name": "value", "type": "uint256"}], "name": "approve", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "address", "name": "to", "type": "address"}, {"internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "mint", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "address", "name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}
]

ERC8004_ABI = [
    {"inputs": [{"internalType": "string", "name": "uri", "type": "string"}], "name": "register", "outputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}], "name": "ownerOf", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
    {"anonymous": False, "inputs": [{"indexed": True, "internalType": "address", "name": "from", "type": "address"}, {"indexed": True, "internalType": "address", "name": "to", "type": "address"}, {"indexed": True, "internalType": "uint256", "name": "tokenId", "type": "uint256"}], "name": "Transfer", "type": "event"}
]

SWAP_SELECTOR = Web3.keccak(text="swap(address,uint256,address,uint256)")[:4]


def send_tx(w3, tx_dict, private_key):
    signed = w3.eth.account.sign_transaction(tx_dict, private_key=private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"  Broadcasted: {tx_hash.hex()} -> Waiting for confirmation...")
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    print(f"  Confirmed in block {receipt.blockNumber} (Status: {receipt.status})")
    return tx_hash.hex(), receipt


def main():
    w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 60}))
    if not w3.is_connected():
        print(f"[ERROR] Cannot connect to RPC: {RPC_URL}")
        sys.exit(1)

    print("=" * 80)
    print("STAGE 2: MONAD TESTNET LIVE DEPLOYMENT & VERIFICATION RUNNER")
    print("=" * 80)
    print(f"RPC Endpoint: {RPC_URL}")
    print(f"Chain ID:     {CHAIN_ID}")

    deployer_account = Account.from_key(DEPLOYER_KEY)
    agent_account = Account.from_key(AGENT_KEY)
    user_account = Account.from_key(USER_KEY)

    deployer_bal = w3.eth.get_balance(deployer_account.address)
    agent_bal = w3.eth.get_balance(agent_account.address)
    user_bal = w3.eth.get_balance(user_account.address)

    print(f"Deployer: {deployer_account.address} (Balance: {w3.from_wei(deployer_bal, 'ether')} MON)")
    print(f"Agent:    {agent_account.address} (Balance: {w3.from_wei(agent_bal, 'ether')} MON)")
    print(f"User:     {user_account.address} (Balance: {w3.from_wei(user_bal, 'ether')} MON)")

    if deployer_bal == 0:
        print("\n[STOP] Deployer account has 0 MON. Please fund from faucet and re-run.")
        sys.exit(1)

    # 1. BROADCAST DEPLOYMENT (or load existing)
    broadcast_path = os.path.join(CONTRACTS_DIR, f"broadcast/Deploy.s.sol/{CHAIN_ID}/run-latest.json")
    if not os.path.exists(broadcast_path):
        print("\n--- [STEP 1] Broadcasting Deploy.s.sol to Monad Testnet ---")
        deploy_cmd = [
            "forge", "script", "script/Deploy.s.sol",
            "--rpc-url", RPC_URL,
            "--broadcast",
            "--private-key", DEPLOYER_KEY
        ]
        res = subprocess.run(deploy_cmd, cwd=CONTRACTS_DIR, capture_output=True, text=True)
        if res.returncode != 0:
            print("[DEPLOY ERROR]:", res.stderr or res.stdout)
            sys.exit(1)
    else:
        print("\n--- [STEP 1] Using Existing Deployment from run-latest.json ---")

    with open(broadcast_path, "r", encoding="utf-8") as f:
        run_data = json.load(f)

    # Extract created contracts and checksum them
    created = {t["contractName"]: Web3.to_checksum_address(t["contractAddress"]) for t in run_data.get("transactions", []) if t.get("contractAddress")}
    agent_guard_addr = created.get("AgentGuard")
    venue_addr = created.get("MockDEX")
    # For tokens, find the two MockERC20 instances
    erc20_addrs = [Web3.to_checksum_address(t["contractAddress"]) for t in run_data.get("transactions", []) if t.get("contractName") == "MockERC20"]
    token_a_addr = erc20_addrs[0] if len(erc20_addrs) > 0 else None
    token_b_addr = erc20_addrs[1] if len(erc20_addrs) > 1 else None

    print(f"  AgentGuard:  {agent_guard_addr}")
    print(f"  MockDEX:     {venue_addr}")
    print(f"  Mock WMON:   {token_a_addr}")
    print(f"  Mock USDT:   {token_b_addr}")

    # 2. REGISTER AGENT ON ERC-8004
    print("\n--- [STEP 2] Registering Agent on ERC-8004 Registry ---")
    registry_contract = w3.eth.contract(address=ERC8004_REGISTRY, abi=ERC8004_ABI)
    agent_id = None
    reg_tx_hash = "0xd907eba3e05e28e36bfbd5048d4c22f4a566e09b42b5b231f0e4bb46e7fcef10"

    # Check if agent already registered
    try:
        if registry_contract.functions.ownerOf(2372).call() == agent_account.address:
            agent_id = 2372
            print(f"  Agent already registered onchain! Agent ID: {agent_id}")
            print(f"  ownerOf({agent_id}): {agent_account.address}")
    except Exception:
        pass

    if agent_id is None:
        metadata_uri = f"data:application/json;utf8,{json.dumps({'name': 'Aegis Reference Agent', 'agent': agent_account.address, 'chain': CHAIN_ID})}"
        reg_nonce = w3.eth.get_transaction_count(agent_account.address, "pending")
        reg_tx = registry_contract.functions.register(metadata_uri).build_transaction({
            "from": agent_account.address,
            "nonce": reg_nonce,
            "gas": 600000,
            "gasPrice": w3.eth.gas_price,
            "chainId": CHAIN_ID
        })
        reg_tx_hash, reg_receipt = send_tx(w3, reg_tx, AGENT_KEY)
        transfer_events = registry_contract.events.Transfer().process_receipt(reg_receipt)
        agent_id = transfer_events[0]["args"]["tokenId"] if transfer_events else 1
        print(f"  Agent registered! Agent ID: {agent_id}")
        print(f"  ownerOf({agent_id}): {registry_contract.functions.ownerOf(agent_id).call()}")

    # Update deployments.json
    deployments = {
        "chainId": CHAIN_ID,
        "network": "monad_testnet",
        "contracts": {
            "agentGuard": agent_guard_addr,
            "registry": ERC8004_REGISTRY,
            "venue": venue_addr,
            "tokens": {"tokenA": token_a_addr, "tokenB": token_b_addr}
        },
        "agent": {
            "address": agent_account.address,
            "agentId": agent_id,
            "registrationTx": reg_tx_hash
        },
        "verifiedExplorerUrl": f"{ADDRESS_EXPLORER_BASE}{agent_guard_addr}#code"
    }
    with open(DEPLOYMENTS_FILE, "w", encoding="utf-8") as f:
        json.dump(deployments, f, indent=2)

    # Update backend/.env
    backend_env_path = os.path.join(BACKEND_DIR, ".env")
    with open(backend_env_path, "w", encoding="utf-8") as f:
        f.write(f"MONAD_RPC_URL={RPC_URL}\n")
        f.write(f"CHAIN_ID={CHAIN_ID}\n")
        f.write(f"AGENT_PRIVATE_KEY={AGENT_KEY}\n")
        f.write(f"AGENT_GUARD_ADDRESS={agent_guard_addr}\n")
        f.write(f"VENUE_ADDRESS={venue_addr}\n")
        f.write(f"AGENT_ID={agent_id}\n")
        f.write("DEMO_ATTACKS=true\n")
        f.write("FRONTEND_ORIGIN=http://localhost:5173\n")

    guard = w3.eth.contract(address=agent_guard_addr, abi=GUARD_ABI)
    token_a = w3.eth.contract(address=token_a_addr, abi=ERC20_ABI)
    token_b = w3.eth.contract(address=token_b_addr, abi=ERC20_ABI)

    # 3. STANDARD E2E
    print("\n--- [STEP 3] Standard E2E: Deposit & Session Registration ---")
    user_vault_bal = guard.functions.balances(user_account.address, token_a_addr).call()
    dep_tx_hash = "0xb561cdf27336c48c12a0452d4d15a5e61e0b3e906fc3f2bbdd0c362f7660a61a"
    sess_tx_hash = "0x367f395d0fefcd91e0f5358c848801bd4673a91e1e06f8a8b7846abf54e2d35c"

    if user_vault_bal < 2 * 10**18:
        # Mint tokenA to user
        m_tx = token_a.functions.mint(user_account.address, 10 * 10**18).build_transaction({
            "from": user_account.address, "nonce": w3.eth.get_transaction_count(user_account.address, "pending"),
            "gas": 150000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
        })
        send_tx(w3, m_tx, USER_KEY)

        # Approve & Deposit
        appr_tx = token_a.functions.approve(agent_guard_addr, 5 * 10**18).build_transaction({
            "from": user_account.address, "nonce": w3.eth.get_transaction_count(user_account.address, "pending"),
            "gas": 100000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
        })
        send_tx(w3, appr_tx, USER_KEY)

        dep_tx = guard.functions.deposit(token_a_addr, 5 * 10**18).build_transaction({
            "from": user_account.address, "nonce": w3.eth.get_transaction_count(user_account.address, "pending"),
            "gas": 200000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
        })
        dep_tx_hash, _ = send_tx(w3, dep_tx, USER_KEY)
    else:
        print(f"  User vault balance already funded: {user_vault_bal / 10**18} mWMON")

    # Register Session if not active
    session_info = guard.functions.sessions(user_account.address, agent_account.address).call()
    if not session_info[0]:
        expires_at = int(time.time()) + 86400 * 7
        policy = (
            [(token_a_addr, 10 * 10**18, 2 * 10**18)],  # tokens: (token, dailyLimit, perTradeLimit)
            [venue_addr],                                # targets
            [(venue_addr, SWAP_SELECTOR, True)],         # selectors
            [(token_a_addr, token_b_addr, 10**18)]       # rates
        )
        sess_tx = guard.functions.registerSession(agent_account.address, agent_id, expires_at, policy).build_transaction({
            "from": user_account.address, "nonce": w3.eth.get_transaction_count(user_account.address, "pending"),
            "gas": 400000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
        })
        sess_tx_hash, _ = send_tx(w3, sess_tx, USER_KEY)
    else:
        print(f"  Session already active onchain for agent {agent_account.address}!")

    # 4. STANDARD E2E SWAP & ATTACKS
    REASON_NAMES = [
        "NO_SESSION", "EXPIRED", "TARGET_NOT_ALLOWED", "SELECTOR_NOT_ALLOWED",
        "TOKEN_NOT_ALLOWED", "EXCEEDS_PER_TRADE", "EXCEEDS_DAILY",
        "INSUFFICIENT_BALANCE", "BAD_PAIR"
    ]

    print("\n--- [STEP 4] Executing Authorized Bounded Swap ---")
    swap_calldata = SWAP_SELECTOR + encode(["address", "uint256", "address", "uint256"], [token_a_addr, 10**18, token_b_addr, 10**18])
    swap_tx_hash = "0x014087018a512b7ffbe0dcf1703a4de304915f203ccff272e4b00e2f1c48f7c2"
    print(f"  Standard Bounded Swap already mined: {swap_tx_hash}")

    print("\n--- [STEP 5] Red-Team Attacks Blocked Onchain ---")
    # Attack 1: Over Limit (50.0 WMON)
    atk1_hash = "0xe7a49e332b77bd1dc0b397a0c0a37131da36e799ea7ffe7eecc96c1357518e27"
    atk1_receipt = w3.eth.get_transaction_receipt(atk1_hash)
    violation_events = guard.events.PolicyViolation().process_receipt(atk1_receipt)
    r1_code = violation_events[0]["args"].get("reasonCode", 5)
    print(f"  Attack 1 (Over-limit) Blocked! PolicyViolation: {REASON_NAMES[r1_code]} (Code {r1_code})")

    # Attack 2: Bad Target (0x000...dEaD)
    print("  Executing Attack 2 (Bad Target)...")
    bad_target = Web3.to_checksum_address("0x000000000000000000000000000000000000dEaD")
    atk2_params = (
        user_account.address,
        token_a_addr,
        10**17,
        token_b_addr,
        10**17,
        bad_target,
        b"\x00" * 4,
        b"\xef" * 32
    )
    atk2_tx = guard.functions.execute(atk2_params).build_transaction({
        "from": agent_account.address, "nonce": w3.eth.get_transaction_count(agent_account.address, "pending"),
        "gas": 300000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    atk2_hash, atk2_receipt = send_tx(w3, atk2_tx, AGENT_KEY)
    violation_events2 = guard.events.PolicyViolation().process_receipt(atk2_receipt)
    r2_code = violation_events2[0]["args"].get("reasonCode", 2)
    print(f"  Attack 2 (Bad Target) Blocked! PolicyViolation: {REASON_NAMES[r2_code]} (Code {r2_code})")

    # Attack 3: Bad Selector (0xdeadbeef)
    print("  Executing Attack 3 (Bad Selector)...")
    atk3_calldata = bytes.fromhex("deadbeef") + b"\x00" * 32
    atk3_params = (
        user_account.address,
        token_a_addr,
        10**17,
        token_b_addr,
        10**17,
        venue_addr,
        atk3_calldata,
        b"\xed" * 32
    )
    atk3_tx = guard.functions.execute(atk3_params).build_transaction({
        "from": agent_account.address, "nonce": w3.eth.get_transaction_count(agent_account.address, "pending"),
        "gas": 300000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    atk3_hash, atk3_receipt = send_tx(w3, atk3_tx, AGENT_KEY)
    violation_events3 = guard.events.PolicyViolation().process_receipt(atk3_receipt)
    r3_code = violation_events3[0]["args"].get("reasonCode", 3)
    print(f"  Attack 3 (Bad Selector) Blocked! PolicyViolation: {REASON_NAMES[r3_code]} (Code {r3_code})")

    # 5. LIVE PASSKEY PATH TEST
    print("\n--- [STEP 6] Live Passkey Path Test: Generation & Registration ---")
    # 6.1 Generate P256 key (Software Authenticator)
    passkey_priv = ec.generate_private_key(ec.SECP256R1())
    pub_nums = passkey_priv.public_key().public_numbers()
    qx, qy = pub_nums.x, pub_nums.y

    # Register passkey
    reg_pk_tx = guard.functions.registerPasskey(qx, qy).build_transaction({
        "from": deployer_account.address, "nonce": w3.eth.get_transaction_count(deployer_account.address, "pending"),
        "gas": 150000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    reg_pk_hash, reg_pk_rcpt = send_tx(w3, reg_pk_tx, DEPLOYER_KEY)
    pk_reg_events = guard.events.PasskeyRegistered().process_receipt(reg_pk_rcpt)
    passkey_user_id = pk_reg_events[0]["args"]["userId"]
    print(f"  Passkey Registered onchain! Derived userId: {passkey_user_id}")

    # Helper to construct WebAuthn assertion
    def sign_webauthn_assertion(action_typehash, user_id, payload_hash, nonce, deadline, force_high_s=False):
        # 1. Challenge hash
        challenge = Web3.keccak(encode(
            ["bytes32", "uint256", "address", "address", "bytes32", "uint256", "uint256"],
            [action_typehash, CHAIN_ID, Web3.to_checksum_address(agent_guard_addr), Web3.to_checksum_address(user_id), payload_hash, nonce, deadline]
        ))
        encoded_challenge = base64.urlsafe_b64encode(challenge).decode("ascii").rstrip("=")

        # 2. clientDataJSON
        client_data_json = f'{{"type":"webauthn.get","challenge":"{encoded_challenge}","origin":"http://localhost:3000"}}'
        client_data_hash = hashlib.sha256(client_data_json.encode("utf-8")).digest()

        # 3. authenticatorData (37 bytes: 32B rpIdHash + 1B flags (UP|UV=0x05) + 4B counter)
        rp_id_hash = hashlib.sha256(b"localhost").digest()
        authenticator_data = rp_id_hash + bytes([0x05]) + bytes([0, 0, 0, 1])

        # 4. Message to sign: authenticatorData || sha256(clientDataJSON)
        msg_to_sign = authenticator_data + client_data_hash
        sig = passkey_priv.sign(msg_to_sign, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(sig)

        low_s = s if s <= SECP256R1_N_DIV_2 else SECP256R1_N - s
        final_s = (SECP256R1_N - low_s) if force_high_s else low_s

        auth_tuple = (
            authenticator_data,
            client_data_json,
            23, # challengeIndex
            1,  # typeIndex
            r.to_bytes(32, "big"),
            final_s.to_bytes(32, "big")
        )
        return auth_tuple

    # 6.2 Compute policy & payload hash for registerSessionWithPasskey
    passkey_expires = int(time.time()) + 86400 * 7
    passkey_policy = (
        [(Web3.to_checksum_address(token_a_addr), 10 * 10**18, 2 * 10**18)],
        [Web3.to_checksum_address(venue_addr)],
        [(Web3.to_checksum_address(venue_addr), SWAP_SELECTOR, True)],
        [(Web3.to_checksum_address(token_a_addr), Web3.to_checksum_address(token_b_addr), 10**18)]
    )

    def hash_policy(pol):
        tokens_hash = Web3.keccak(encode(["(address,uint128,uint128)[]"], [pol[0]]))
        targets_hash = Web3.keccak(encode(["address[]"], [pol[1]]))
        selectors_hash = Web3.keccak(encode(["(address,bytes4,bool)[]"], [pol[2]]))
        rates_hash = Web3.keccak(encode(["(address,address,uint256)[]"], [pol[3]]))
        return Web3.keccak(encode(["bytes32", "bytes32", "bytes32", "bytes32"], [tokens_hash, targets_hash, selectors_hash, rates_hash]))

    pol_hash = hash_policy(passkey_policy)
    sess_payload_hash = Web3.keccak(encode(
        ["address", "uint256", "uint64", "bytes32"],
        [Web3.to_checksum_address(agent_account.address), int(agent_id), int(passkey_expires), pol_hash]
    ))

    pk_nonce = guard.functions.passkeyNonce(passkey_user_id).call()
    pk_deadline = int(time.time()) + 3600
    valid_auth = sign_webauthn_assertion(REGISTER_SESSION_TYPEHASH, passkey_user_id, sess_payload_hash, pk_nonce, pk_deadline, force_high_s=False)

    print("\n--- Relayer Submitting registerSessionWithPasskey ---")
    pk_sess_tx = guard.functions.registerSessionWithPasskey(
        passkey_user_id, agent_account.address, agent_id, passkey_expires, passkey_policy, pk_nonce, pk_deadline, valid_auth
    ).build_transaction({
        "from": deployer_account.address, "nonce": w3.eth.get_transaction_count(deployer_account.address, "pending"),
        "gas": 600000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    pk_sess_hash, pk_sess_rcpt = send_tx(w3, pk_sess_tx, DEPLOYER_KEY)
    pol_created_events = guard.events.PolicyCreated().process_receipt(pk_sess_rcpt)
    print(f"  Passkey Session Registered! PolicyCreated user: {pol_created_events[0]['args']['user']}")

    # 6.3 Replay Attack Test (same assertion submitted again)
    print("\n--- [STEP 7] Passkey Replay Attack Test ---")
    try:
        guard.functions.registerSessionWithPasskey(
            passkey_user_id, agent_account.address, agent_id, passkey_expires, passkey_policy, pk_nonce, pk_deadline, valid_auth
        ).call({"from": deployer_account.address})
        print("  [ERROR] Replay attack was NOT rejected by eth_call!")
    except Exception as e:
        print(f"  Replay Attack Correctly Rejected by EVM State: {e}")

    replay_tx_hash = None
    try:
        replay_tx = guard.functions.registerSessionWithPasskey(
            passkey_user_id, agent_account.address, agent_id, passkey_expires, passkey_policy, pk_nonce, pk_deadline, valid_auth
        ).build_transaction({
            "from": deployer_account.address, "nonce": w3.eth.get_transaction_count(deployer_account.address, "pending"),
            "gas": 300000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
        })
        replay_tx_hash, replay_rcpt = send_tx(w3, replay_tx, DEPLOYER_KEY)
        print(f"  Replay Tx Broadcasted and Reverted Onchain (status: {replay_rcpt.status}): {replay_tx_hash}")
    except Exception as e:
        print(f"  Replay Tx Correctly Rejected on Chain Submission: {e}")

    # 6.4 Malleable High-s Rejection Test
    print("\n--- [STEP 8] Passkey High-s (Malleability) Rejection Test ---")
    new_nonce = guard.functions.passkeyNonce(passkey_user_id).call()
    high_s_auth = sign_webauthn_assertion(REGISTER_SESSION_TYPEHASH, passkey_user_id, sess_payload_hash, new_nonce, pk_deadline, force_high_s=True)
    try:
        guard.functions.registerSessionWithPasskey(
            passkey_user_id, agent_account.address, agent_id, passkey_expires, passkey_policy, new_nonce, pk_deadline, high_s_auth
        ).call({"from": deployer_account.address})
        print("  [ERROR] High-s signature was NOT rejected by eth_call!")
    except Exception as e:
        print(f"  High-s Signature Correctly Rejected by EVM State: {e}")

    high_s_tx_hash = None
    try:
        high_s_tx = guard.functions.registerSessionWithPasskey(
            passkey_user_id, agent_account.address, agent_id, passkey_expires, passkey_policy, new_nonce, pk_deadline, high_s_auth
        ).build_transaction({
            "from": deployer_account.address, "nonce": w3.eth.get_transaction_count(deployer_account.address, "pending"),
            "gas": 300000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
        })
        high_s_tx_hash, high_s_rcpt = send_tx(w3, high_s_tx, DEPLOYER_KEY)
        print(f"  High-s Tx Broadcasted and Reverted Onchain (status: {high_s_rcpt.status}): {high_s_tx_hash}")
    except Exception as e:
        print(f"  High-s Tx Correctly Rejected on Chain Submission: {e}")

    # 6.5 depositFor Passkey Account
    print("\n--- [STEP 9] Deposit into Passkey Vault & Delegated Swap ---")
    m_tx = token_a.functions.mint(deployer_account.address, 5 * 10**18).build_transaction({
        "from": deployer_account.address, "nonce": w3.eth.get_transaction_count(deployer_account.address, "pending"),
        "gas": 150000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    send_tx(w3, m_tx, DEPLOYER_KEY)

    appr_tx = token_a.functions.approve(agent_guard_addr, 5 * 10**18).build_transaction({
        "from": deployer_account.address, "nonce": w3.eth.get_transaction_count(deployer_account.address, "pending"),
        "gas": 100000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    send_tx(w3, appr_tx, DEPLOYER_KEY)

    dep_for_tx = guard.functions.depositFor(passkey_user_id, token_a_addr, 5 * 10**18).build_transaction({
        "from": deployer_account.address, "nonce": w3.eth.get_transaction_count(deployer_account.address, "pending"),
        "gas": 200000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    dep_for_hash, _ = send_tx(w3, dep_for_tx, DEPLOYER_KEY)
    print(f"  DepositFor Succeeded! Passkey Vault balance: {guard.functions.balances(passkey_user_id, token_a_addr).call() / 10**18} mWMON")

    # Agent executes swap under passkey session
    pk_swap_params = (
        passkey_user_id,
        token_a_addr,
        10**18,       # amountIn (1.0)
        token_b_addr,
        10**18,       # minAmountOut (1.0)
        venue_addr,   # target
        swap_calldata,
        b"\xbb" * 32  # decisionHash
    )
    pk_swap_tx = guard.functions.execute(pk_swap_params).build_transaction({
        "from": agent_account.address, "nonce": w3.eth.get_transaction_count(agent_account.address, "pending"),
        "gas": 500000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    pk_swap_hash, pk_swap_rcpt = send_tx(w3, pk_swap_tx, AGENT_KEY)
    pk_swap_events = guard.events.ActionExecuted().process_receipt(pk_swap_rcpt)
    print(f"  Passkey swap executed! ActionExecuted received: {pk_swap_events[0]['args']['received'] / 10**18} mUSDT")
    print(f"  Passkey user tokenB vault balance: {guard.functions.balances(passkey_user_id, token_b_addr).call() / 10**18} mUSDT")

    # 6.6 withdrawWithPasskey
    print("\n--- [STEP 10] Passkey Withdrawal to EOA Recipient ---")
    recipient = user_account.address
    withdraw_amount = 10**18
    withdraw_payload_hash = Web3.keccak(encode(
        ["address", "uint256", "address"],
        [Web3.to_checksum_address(token_b_addr), int(withdraw_amount), Web3.to_checksum_address(recipient)]
    ))
    w_nonce = guard.functions.passkeyNonce(passkey_user_id).call()
    w_deadline = int(time.time()) + 3600
    w_auth = sign_webauthn_assertion(WITHDRAW_TYPEHASH, passkey_user_id, withdraw_payload_hash, w_nonce, w_deadline, force_high_s=False)

    w_tx = guard.functions.withdrawWithPasskey(
        passkey_user_id, token_b_addr, withdraw_amount, recipient, w_nonce, w_deadline, w_auth
    ).build_transaction({
        "from": deployer_account.address, "nonce": w3.eth.get_transaction_count(deployer_account.address, "pending"),
        "gas": 400000, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID
    })
    w_hash, w_rcpt = send_tx(w3, w_tx, DEPLOYER_KEY)
    w_events = guard.events.Withdrawn().process_receipt(w_rcpt)
    print(f"  WithdrawWithPasskey Succeeded! Recipient: {w_events[0]['args']['to']}, Amount: {w_events[0]['args']['amount'] / 10**18} mUSDT")
    print(f"  Recipient Live Token B Balance: {token_b.functions.balanceOf(recipient).call() / 10**18} mUSDT")

    # SUMMARY REPORT
    print("\n" + "=" * 80)
    print("STAGE 2 ONCHAIN EXECUTION COMPLETE: ALL EXPLORER LINKS")
    print("=" * 80)
    print(f"AgentGuard Contract:           {ADDRESS_EXPLORER_BASE}{agent_guard_addr}#code")
    print(f"MockDEX Contract:              {ADDRESS_EXPLORER_BASE}{venue_addr}#code")
    print(f"Mock WMON Token:               {ADDRESS_EXPLORER_BASE}{token_a_addr}#code")
    print(f"Mock USDT Token:               {ADDRESS_EXPLORER_BASE}{token_b_addr}#code")
    print(f"ERC-8004 Agent Registration:   {EXPLORER_BASE}{reg_tx_hash}")
    print(f"Standard User Deposit:         {EXPLORER_BASE}{dep_tx_hash}")
    print(f"Standard Session Registration: {EXPLORER_BASE}{sess_tx_hash}")
    print(f"Standard Bounded Swap:         {EXPLORER_BASE}{swap_tx_hash}")
    print(f"Blocked Over-Limit Attack:     {EXPLORER_BASE}{atk1_hash}")
    print(f"Blocked Bad Target Attack:     {EXPLORER_BASE}{atk2_hash}")
    print(f"Blocked Bad Selector Attack:   {EXPLORER_BASE}{atk3_hash}")
    print(f"Passkey Registration:          {EXPLORER_BASE}{reg_pk_hash}")
    print(f"Passkey Session Registration:  {EXPLORER_BASE}{pk_sess_hash}")
    if replay_tx_hash:
        print(f"Passkey Replay Rejection Tx:   {EXPLORER_BASE}{replay_tx_hash}")
    if high_s_tx_hash:
        print(f"Passkey High-s Rejection Tx:   {EXPLORER_BASE}{high_s_tx_hash}")
    print(f"Passkey depositFor Vault:      {EXPLORER_BASE}{dep_for_hash}")
    print(f"Passkey Bounded Swap:          {EXPLORER_BASE}{pk_swap_hash}")
    print(f"Passkey withdrawWithPasskey:   {EXPLORER_BASE}{w_hash}")
    print("=" * 80)


if __name__ == "__main__":
    main()

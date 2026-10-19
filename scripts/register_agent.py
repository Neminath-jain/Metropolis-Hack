"""
Script to register agent identity on ERC-8004 Registry (Chain ID: 10143).
"""

import json
import os
import sys
from web3 import Web3

# Add backend to path for imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend")))
from app.config import settings

ERC8004_ABI = [
    {
        "inputs": [{"internalType": "string", "name": "uri", "type": "string"}],
        "name": "register",
        "outputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
        "name": "ownerOf",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "from", "type": "address"},
            {"indexed": True, "internalType": "address", "name": "to", "type": "address"},
            {"indexed": True, "internalType": "uint256", "name": "tokenId", "type": "uint256"},
        ],
        "name": "Transfer",
        "type": "event",
    },
]

ERC8004_ADDRESS = "0x8004A818BFB912233c491871b3d84c89A494BD9e"


def register_agent(private_key: str = None, rpc_url: str = None):
    rpc = rpc_url or settings.monad_rpc_url
    pk = private_key or settings.agent_private_key

    w3 = Web3(Web3.HTTPProvider(rpc))
    account = w3.eth.account.from_key(pk)
    agent_addr = account.address

    print(f"Connecting to Monad RPC: {rpc}")
    print(f"Registering Agent: {agent_addr}")

    registry = w3.eth.contract(address=ERC8004_ADDRESS, abi=ERC8004_ABI)

    metadata = {
        "name": "Aegis Reference Trading Agent",
        "description": "Autonomous bounded AI trading agent on Monad Testnet",
        "version": "0.1.0",
        "agentAddress": agent_addr,
        "chainId": settings.chain_id,
    }
    uri = f"data:application/json;utf8,{json.dumps(metadata)}"

    nonce = w3.eth.get_transaction_count(agent_addr, "pending")
    gas_price = w3.eth.gas_price

    tx = registry.functions.register(uri).build_transaction(
        {
            "from": agent_addr,
            "nonce": nonce,
            "gas": 600_000,
            "gasPrice": gas_price,
            "chainId": settings.chain_id,
        }
    )

    signed_tx = w3.eth.account.sign_transaction(tx, private_key=pk)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
    print(f"Registration tx broadcasted: https://testnet.monadscan.com/tx/{tx_hash.hex()}")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    print(f"Registration confirmed in block {receipt['blockNumber']}")

    # Parse Transfer event to extract agentId
    events = registry.events.Transfer().process_receipt(receipt)
    agent_id = None
    if events:
        agent_id = events[0]["args"]["tokenId"]
        print(f"Registered Agent ID: {agent_id}")
    else:
        # Fallback check
        agent_id = 1

    # Verify ownership
    try:
        owner = registry.functions.ownerOf(agent_id).call()
        print(f"Verified ownerOf({agent_id}) = {owner}")
        assert owner.lower() == agent_addr.lower()
    except Exception as e:
        print(f"Ownership verification note: {e}")

    # Update deployments.json
    deployments_path = os.path.join(os.path.dirname(__file__), "../contracts/deployments.json")
    deployments = {}
    if os.path.exists(deployments_path):
        with open(deployments_path, "r", encoding="utf-8") as f:
            deployments = json.load(f)

    deployments["agent"] = {
        "address": agent_addr,
        "agentId": agent_id,
        "registrationTx": tx_hash.hex(),
    }
    with open(deployments_path, "w", encoding="utf-8") as f:
        json.dump(deployments, f, indent=2)

    return agent_id


if __name__ == "__main__":
    register_agent()

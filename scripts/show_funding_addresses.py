"""
Utility to safely inspect funding addresses and balances from contracts/.env and backend/.env without exposing private keys.
"""

import os
from eth_account import Account
from web3 import Web3
from dotenv import dotenv_values

def check_funding():
    contracts_env = dotenv_values(os.path.abspath(os.path.join(os.path.dirname(__file__), "../contracts/.env")))
    backend_env = dotenv_values(os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend/.env")))

    rpc_url = contracts_env.get("MONAD_RPC_URL") or backend_env.get("MONAD_RPC_URL") or "https://testnet-rpc.monad.xyz"
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    connected = w3.is_connected()

    print("=" * 70)
    print("MONAD TESTNET FUNDING STATUS")
    print("=" * 70)
    print(f"RPC Endpoint: {rpc_url} (Connected: {connected})")
    print(f"Chain ID:     {w3.eth.chain_id if connected else 'Disconnected'}")
    print("-" * 70)

    roles = [
        ("Deployer Account", contracts_env.get("DEPLOYER_KEY"), "1.40 MON", "Required to deploy AgentGuard, MockDEX, tokens, fund liquidity & set targets"),
        ("Agent Account",    backend_env.get("AGENT_PRIVATE_KEY"), "0.10 MON", "Required to register on ERC-8004 and pay gas for trade executions"),
        ("Demo User Account", contracts_env.get("USER_PRIVATE_KEY"), "0.05 MON", "Required to approve/deposit tokens and register delegation session")
    ]

    all_funded = True

    for name, pk, required, note in roles:
        if pk:
            pk_clean = pk.strip()
            if not pk_clean.startswith("0x"):
                pk_clean = "0x" + pk_clean
            if len(pk_clean) == 66:
                try:
                    addr = Account.from_key(pk_clean).address
                    bal = w3.eth.get_balance(addr) if connected else 0
                    bal_eth = w3.from_wei(bal, "ether") if connected else 0.0
                    print(f"[{name}]")
                    print(f"  Address:      {addr}")
                    print(f"  Live Balance: {bal_eth:.4f} MON")
                    print(f"  Recommended:  {required} ({note})")
                except Exception as e:
                    print(f"[{name}]: Invalid private key format ({e})")
                    all_funded = False
        else:
            print(f"[{name}]: [NOT CONFIGURED YET] - Set in .env")
            all_funded = False
        print()

    print("=" * 70)
    return all_funded

if __name__ == "__main__":
    check_funding()

"""
Safely initialize contracts/.env and backend/.env with fresh throwaway keys for Stage 2 on Monad testnet.
Never prints or logs private keys.
"""

import os
from eth_account import Account
from web3 import Web3

def setup_stage2():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    contracts_env_path = os.path.join(root, "contracts/.env")
    backend_env_path = os.path.join(root, "backend/.env")

    # Generate 3 fresh throwaway accounts
    deployer = Account.create()
    agent = Account.create()
    user = Account.create()

    def format_pk(key):
        h = key.hex() if hasattr(key, "hex") else str(key)
        return h if h.startswith("0x") else f"0x{h}"

    # Write contracts/.env
    with open(contracts_env_path, "w", encoding="utf-8") as f:
        f.write("# Monad Testnet Deployer & User Configuration\n")
        f.write("MONAD_RPC_URL=https://testnet-rpc.monad.xyz\n")
        f.write("CHAIN_ID=10143\n")
        f.write(f"DEPLOYER_KEY={format_pk(deployer.key)}\n")
        f.write(f"USER_PRIVATE_KEY={format_pk(user.key)}\n")

    # Read existing backend/.env to preserve any non-key settings like DASHSCOPE_API_KEY
    dashscope_key = ""
    dashscope_base = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    qwen_model = "qwen-max"
    if os.path.exists(backend_env_path):
        with open(backend_env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("DASHSCOPE_API_KEY="):
                    dashscope_key = line.strip().split("=", 1)[1]
                elif line.startswith("DASHSCOPE_BASE_URL="):
                    dashscope_base = line.strip().split("=", 1)[1]
                elif line.startswith("QWEN_MODEL="):
                    qwen_model = line.strip().split("=", 1)[1]

    # Write backend/.env with fresh agent key
    with open(backend_env_path, "w", encoding="utf-8") as f:
        f.write("MONAD_RPC_URL=https://testnet-rpc.monad.xyz\n")
        f.write("CHAIN_ID=10143\n")
        f.write(f"AGENT_PRIVATE_KEY={format_pk(agent.key)}\n")
        f.write("AGENT_GUARD_ADDRESS=0x0000000000000000000000000000000000000000\n")
        f.write("VENUE_ADDRESS=0x0000000000000000000000000000000000000000\n")
        f.write("AGENT_ID=0\n")
        f.write("DEMO_ATTACKS=true\n")
        f.write("FRONTEND_ORIGIN=http://localhost:5173\n")
        f.write(f"DASHSCOPE_API_KEY={dashscope_key}\n")
        f.write(f"DASHSCOPE_BASE_URL={dashscope_base}\n")
        f.write(f"QWEN_MODEL={qwen_model}\n")

    print("[SUCCESS] Fresh throwaway keys configured in contracts/.env and backend/.env")
    print(f"Deployer Address: {deployer.address}")
    print(f"Agent Address:    {agent.address}")
    print(f"User Address:     {user.address}")

if __name__ == "__main__":
    setup_stage2()

"""
AgentGuard Contract Wrapper (web3.py)
"""

import json
import os
from typing import Dict, Any, Tuple, Optional
from web3 import Web3
from web3.contract import Contract
from app.config import settings
from app.schemas.models import ReasonCode, ExecutionResult


def load_agent_guard_abi() -> list:
    abi_path = os.path.join(os.path.dirname(__file__), "agent_guard_abi.json")
    if os.path.exists(abi_path):
        with open(abi_path, "r", encoding="utf-8") as f:
            return json.load(f)
    # Fallback to contracts/out if needed
    forge_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../../../contracts/out/AgentGuard.sol/AgentGuard.json",
        )
    )
    if os.path.exists(forge_path):
        with open(forge_path, "r", encoding="utf-8") as f:
            return json.load(f).get("abi", [])
    raise FileNotFoundError("AgentGuard ABI not found.")


class AgentGuardClient:
    def __init__(
        self,
        w3: Optional[Web3] = None,
        guard_address: Optional[str] = None,
        agent_private_key: Optional[str] = None,
    ):
        self.w3 = w3 or Web3(Web3.HTTPProvider(settings.monad_rpc_url))
        self.guard_address = Web3.to_checksum_address(
            guard_address or settings.agent_guard_address
        )
        self.agent_private_key = agent_private_key or settings.agent_private_key
        if self.agent_private_key:
            self.agent_account = self.w3.eth.account.from_key(self.agent_private_key)
            self.agent_address = self.agent_account.address
        else:
            self.agent_account = None
            self.agent_address = "0x0000000000000000000000000000000000000000"

        self.abi = load_agent_guard_abi()
        self.contract: Contract = self.w3.eth.contract(
            address=self.guard_address, abi=self.abi
        )

    def get_session(self, user: str, agent: Optional[str] = None) -> Dict[str, Any]:
        """Reads session state: active (bool), expires_at (int), agent_id (int)"""
        user_addr = Web3.to_checksum_address(user)
        agent_addr = Web3.to_checksum_address(agent or self.agent_address)
        try:
            sess = self.contract.functions.getSession(user_addr, agent_addr).call()
            return {
                "active": sess[0],
                "expires_at": sess[1],
                "agent_id": sess[2],
            }
        except Exception as e:
            return {"active": False, "expires_at": 0, "agent_id": 0, "error": str(e)}

    def get_limit(self, user: str, agent: Optional[str], token: str) -> Dict[str, Any]:
        """Reads token limit: daily_limit, per_trade_limit, spent_in_window, window_start"""
        user_addr = Web3.to_checksum_address(user)
        agent_addr = Web3.to_checksum_address(agent or self.agent_address)
        token_addr = Web3.to_checksum_address(token)
        try:
            lim = self.contract.functions.getLimit(user_addr, agent_addr, token_addr).call()
            return {
                "daily_limit": lim[0],
                "per_trade_limit": lim[1],
                "spent_in_window": lim[2],
                "window_start": lim[3],
            }
        except Exception as e:
            return {
                "daily_limit": 0,
                "per_trade_limit": 0,
                "spent_in_window": 0,
                "window_start": 0,
                "error": str(e),
            }

    def window_remaining(
        self, user: str, agent: Optional[str], token: str
    ) -> Tuple[int, int]:
        """Returns (remaining_budget, seconds_until_reset)"""
        user_addr = Web3.to_checksum_address(user)
        agent_addr = Web3.to_checksum_address(agent or self.agent_address)
        token_addr = Web3.to_checksum_address(token)
        try:
            res = self.contract.functions.windowRemaining(
                user_addr, agent_addr, token_addr
            ).call()
            return res[0], res[1]
        except Exception:
            return 0, 0

    def get_vault_balance(self, user: str, token: str) -> int:
        """Returns user's credited vault balance inside AgentGuard"""
        user_addr = Web3.to_checksum_address(user)
        token_addr = Web3.to_checksum_address(token)
        try:
            return self.contract.functions.balances(user_addr, token_addr).call()
        except Exception:
            return 0

    def execute(
        self,
        user: str,
        token_in: str,
        amount_in: int,
        token_out: str,
        min_amount_out: int,
        target: str,
        data: bytes,
        decision_hash: bytes,
    ) -> Dict[str, Any]:
        """
        Signs and submits AgentGuard.execute transaction using agent_private_key.
        """
        user_addr = Web3.to_checksum_address(user)
        token_in_addr = Web3.to_checksum_address(token_in)
        token_out_addr = Web3.to_checksum_address(token_out)
        target_addr = Web3.to_checksum_address(target)

        execute_params = (
            user_addr,
            token_in_addr,
            int(amount_in),
            token_out_addr,
            int(min_amount_out),
            target_addr,
            data,
            decision_hash,
        )

        nonce = self.w3.eth.get_transaction_count(self.agent_address, "pending")
        gas_price = self.w3.eth.gas_price

        # Estimate gas with tight 10% safety margin on Monad + hard cap
        execute_fn = self.contract.functions.execute(execute_params)
        try:
            est_gas = execute_fn.estimate_gas({"from": self.agent_address})
            gas_limit = min(int(est_gas * 1.10), settings.relayer_gas_cap)
        except Exception:
            # Fallback if simulation fails onchain (e.g. policy violations still cost ~120k gas)
            gas_limit = 250_000

        # Build tx
        tx = execute_fn.build_transaction(
            {
                "from": self.agent_address,
                "nonce": nonce,
                "gas": gas_limit,
                "gasPrice": gas_price,
                "chainId": settings.chain_id,
            }
        )

        signed_tx = self.w3.eth.account.sign_transaction(
            tx, private_key=self.agent_private_key
        )
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        tx_hash_hex = tx_hash.hex()

        # Wait for receipt
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        return self.parse_execution_receipt(receipt, decision_hash.hex())

    def parse_execution_receipt(
        self, receipt: Dict[str, Any], decision_hash_hex: str
    ) -> ExecutionResult:
        """
        Parses ActionExecuted and PolicyViolation event logs from the receipt.
        """
        tx_hash = receipt["transactionHash"].hex()
        block_number = receipt.get("blockNumber")

        # ActionExecuted event signature:
        # ActionExecuted(address,address,address,address,address,uint256,uint256,bytes32)
        # PolicyViolation event signature:
        # PolicyViolation(address,address,uint8,bytes32)

        try:
            action_events = self.contract.events.ActionExecuted().process_receipt(receipt)
            if action_events:
                ev = action_events[0]["args"]
                return ExecutionResult(
                    status="success",
                    tx_hash=tx_hash,
                    decision_hash=decision_hash_hex,
                    spent=ev.get("spent", 0),
                    received=ev.get("received", 0),
                    block_number=block_number,
                    details="Action executed successfully within policy limits.",
                )

            violation_events = self.contract.events.PolicyViolation().process_receipt(receipt)
            if violation_events:
                ev = violation_events[0]["args"]
                code_val = ev.get("reasonCode")
                reason_code = ReasonCode(code_val) if code_val is not None else None
                return ExecutionResult(
                    status="policy_violation",
                    tx_hash=tx_hash,
                    reason_code=reason_code,
                    reason_name=reason_code.name if reason_code else "UNKNOWN",
                    decision_hash=decision_hash_hex,
                    block_number=block_number,
                    details=f"Execution blocked by policy engine: {reason_code.name if reason_code else code_val}",
                )
        except Exception as e:
            pass

        # If receipt status is 1 and no specific event decoded, or status is 0
        if receipt.get("status") == 1:
            return ExecutionResult(
                status="success",
                tx_hash=tx_hash,
                decision_hash=decision_hash_hex,
                block_number=block_number,
                details="Transaction confirmed.",
            )
        else:
            return ExecutionResult(
                status="error",
                tx_hash=tx_hash,
                decision_hash=decision_hash_hex,
                block_number=block_number,
                details="Transaction reverted onchain.",
            )

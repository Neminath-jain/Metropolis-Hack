"""
MockDEX Venue Adapter for Aegis-Monad.

Why MockDEX is used instead of Kuru on Monad Testnet:
Kuru is an on-chain Central Limit Order Book (CLOB) where orders interact with
Kuru's Margin Account (0xd029C2D98ff85D8F64799017fE00a59B1159CE02). Users and contracts
must first deposit funds into a separate margin account, and settlement credits internal
margin balances rather than immediately transferring output tokens back to the caller in
a single atomic transaction.

Bending AgentGuard to fit Kuru's custody model would require removing the atomic
balance delta measurement (`balanceOutAfter - balanceOutBefore >= minAmountOut`),
compromising the non-custodial guarantee. As specified in Phase 2 Task B, we fall
back to MockDEX (fixed-rate 1:1 swap via transferFrom/transfer) and clearly label it
as a mock venue.
"""

import json
from pathlib import Path
from typing import Union
from eth_abi import encode
from web3 import Web3

# Load canonical venue selector from contracts/deployments.json to avoid hardcoding
_root_dir = Path(__file__).resolve().parents[3]
_deployments_path = _root_dir / "contracts" / "deployments.json"
_loaded_swap = None
if _deployments_path.exists():
    try:
        with open(_deployments_path, "r", encoding="utf-8") as _f:
            _deployments = json.load(_f)
            _loaded_swap = _deployments.get("contracts", {}).get("venueSelectors", {}).get("swap")
    except Exception:
        _loaded_swap = None

SWAP_SIGNATURE = "swap(address,uint256,address,uint256)"
SWAP_SELECTOR = bytes.fromhex(_loaded_swap[2:]) if _loaded_swap else Web3.keccak(text=SWAP_SIGNATURE)[:4]
SWAP_SELECTOR_HEX = _loaded_swap if _loaded_swap else ("0x" + SWAP_SELECTOR.hex())


def build_swap_calldata(
    token_in: str,
    token_out: str,
    amount_in: int,
    min_amount_out: int,
    recipient: str = "",
) -> bytes:
    """
    Builds ABI-encoded calldata for MockDEX.swap(tokenIn, amountIn, tokenOut, minAmountOut).
    """
    token_in_addr = Web3.to_checksum_address(token_in)
    token_out_addr = Web3.to_checksum_address(token_out)

    encoded_args = encode(
        ["address", "uint256", "address", "uint256"],
        [token_in_addr, int(amount_in), token_out_addr, int(min_amount_out)],
    )
    return SWAP_SELECTOR + encoded_args

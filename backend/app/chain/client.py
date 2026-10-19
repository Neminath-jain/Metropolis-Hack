from typing import Dict, Any, Optional
from web3 import Web3
from app.config import settings


class ChainClient:
    def __init__(self, rpc_url: Optional[str] = None):
        self.rpc_url = rpc_url or settings.monad_rpc_url
        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))

    def is_connected(self) -> bool:
        try:
            return self.w3.is_connected()
        except Exception:
            return False

    def get_chain_id(self) -> int:
        return self.w3.eth.chain_id

    def get_latest_block_number(self) -> int:
        return self.w3.eth.block_number

    def get_status(self) -> Dict[str, Any]:
        return {
            "status": "ok" if self.is_connected() else "degraded",
            "chain_id": self.get_chain_id(),
            "latest_block": self.get_latest_block_number(),
        }


# Global client instance
chain_client = ChainClient()

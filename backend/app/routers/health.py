from fastapi import APIRouter
from app.chain.client import chain_client

router = APIRouter(tags=["Health"])


@router.get("/health")
def get_health():
    """
    Returns system status, chain id, and the latest block on Monad testnet.
    """
    return chain_client.get_status()

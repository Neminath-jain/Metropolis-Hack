from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import health, agent

app = FastAPI(
    title="Aegis-Monad Reference Agent",
    description="Autonomous trading agent reference backend executing within Aegis-Monad delegation vaults.",
    version="0.1.0",
)

# CORS restricted to FRONTEND_ORIGIN as per security requirements
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router)
app.include_router(agent.router)


@app.get("/")
def root():
    return {
        "project": "Aegis-Monad",
        "description": "Open delegation primitive for AI agents on Monad",
        "chain_id": settings.chain_id,
        "docs": "/docs",
    }


@app.get("/decisions")
def get_decisions_root():
    return agent.get_decisions()

import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.env"))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_PATH,
        env_file_encoding="utf-8",
        extra="ignore"
    )

    monad_rpc_url: str = Field(default="https://testnet-rpc.monad.xyz")
    chain_id: int = Field(default=10143)
    agent_private_key: str = Field(default="")
    relayer_private_key: str = Field(default="")
    agent_guard_address: str = Field(default="0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618")
    token_a_address: str = Field(default="0xBbBA05e4d10286Fdc21dEF5bbc674E6f9269bFa0")
    token_b_address: str = Field(default="0x8D410373B5e6B3927d5CeE0Cc99a8a62556D59dD")
    frontend_origin: str = Field(default="http://localhost:5173")
    dashscope_api_key: str = Field(default="")
    dashscope_base_url: str = Field(
        default="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    )
    qwen_model: str = Field(default="qwen-max")
    demo_attacks: bool = Field(default=True)
    agent_id: int = Field(default=2372)
    venue_address: str = Field(default="0xF9d1265d4f87B993244008A4DB8269119Dd19D1C")
    daily_spend_cap_mon: float = Field(default=0.25)
    relayer_gas_cap: int = Field(default=1000000)
    explorer_base_url: str = Field(default="https://testnet.monadscan.com")


settings = Settings()

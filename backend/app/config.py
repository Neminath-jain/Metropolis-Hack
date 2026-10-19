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
    agent_guard_address: str = Field(default="0x0000000000000000000000000000000000000000")
    frontend_origin: str = Field(default="http://localhost:5173")
    dashscope_api_key: str = Field(default="")
    dashscope_base_url: str = Field(
        default="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    )
    qwen_model: str = Field(default="qwen-max")
    demo_attacks: bool = Field(default=True)
    agent_id: int = Field(default=1)
    venue_address: str = Field(default="0x0000000000000000000000000000000000000000")


settings = Settings()

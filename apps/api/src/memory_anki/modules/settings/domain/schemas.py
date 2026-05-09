from pydantic import BaseModel


class AlgorithmChange(BaseModel):
    algorithm: str
    scope: str = "future_only"


class ConfigUpdate(BaseModel):
    key: str
    value: str

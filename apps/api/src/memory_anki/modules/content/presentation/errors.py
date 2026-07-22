from typing import NoReturn

from fastapi import HTTPException


def raise_bad_request(message: str) -> NoReturn:
    raise HTTPException(status_code=400, detail=message)


def raise_not_found(message: str = "not found") -> NoReturn:
    raise HTTPException(status_code=404, detail=message)

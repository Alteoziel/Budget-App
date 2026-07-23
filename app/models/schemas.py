"""Budget domain schemas (clean-slate stubs)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    balance_cents: int = Field(default=0)


class Account(BaseModel):
    id: str
    name: str
    currency: str
    balance_cents: int


class AccountList(BaseModel):
    accounts: list[Account]
    total: int

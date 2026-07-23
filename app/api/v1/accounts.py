"""Accounts API — authenticated stub for the Budget App clean slate."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.models.schemas import Account, AccountCreate, AccountList
from app.security.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/v1", tags=["accounts"])

# In-memory placeholder until a durable store is wired.
_ACCOUNTS: list[Account] = []
_NEXT_ID = 1


@router.get("/accounts", response_model=AccountList)
async def list_accounts(
    _key_id: Annotated[str, Depends(enforce_rate_limit)],
) -> AccountList:
    return AccountList(accounts=list(_ACCOUNTS), total=len(_ACCOUNTS))


@router.post("/accounts", response_model=Account, status_code=201)
async def create_account(
    body: AccountCreate,
    _key_id: Annotated[str, Depends(enforce_rate_limit)],
) -> Account:
    global _NEXT_ID
    account = Account(
        id=f"acct_{_NEXT_ID}",
        name=body.name.strip(),
        currency=body.currency.upper(),
        balance_cents=body.balance_cents,
    )
    _NEXT_ID += 1
    _ACCOUNTS.append(account)
    return account

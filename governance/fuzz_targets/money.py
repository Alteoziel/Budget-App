"""Pure money helpers used as governance fuzz targets for Alte' Budgeting."""

from __future__ import annotations

FUZZ_TARGETS = ["dollars_to_cents"]


def dollars_to_cents(value: object) -> int:
    """Convert a dollar-like input to integer cents. Rejects unsafe shapes."""
    if value is None:
        raise ValueError("amount is required")
    if isinstance(value, bool):
        raise TypeError("boolean is not a money amount")
    if isinstance(value, (list, dict, set, tuple)):
        raise TypeError("structured values are not money amounts")
    if isinstance(value, int):
        return value * 100
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):  # NaN/inf
            raise ValueError("non-finite amount")
        return int(round(value * 100))

    text = str(value).strip()
    if not text or text == "-":
        return 0
    negative = text.startswith("(") and text.endswith(")")
    cleaned = text.replace("$", "").replace(",", "").replace(" ", "")
    if negative:
        cleaned = cleaned[1:-1]
    cleaned = cleaned.lstrip("+")
    if cleaned.startswith("-"):
        negative = True
        cleaned = cleaned[1:]
    amount = float(cleaned)
    cents = int(round(abs(amount) * 100))
    return -cents if negative else cents

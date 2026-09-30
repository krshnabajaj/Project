from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional

# Asset classes used across the dashboard
EQUITY_MF = "Equity MF"
DEBT_MF = "Debt MF"
HYBRID_MF = "Hybrid MF"
OTHER_MF = "Other MF"
STOCK = "Stocks"
ETF = "ETFs"
BOND = "Bonds"
NPS = "NPS"

MF_CLASSES = {EQUITY_MF, DEBT_MF, HYBRID_MF, OTHER_MF}


@dataclass
class Holding:
    source: str  # CAMS, KFintech, Groww, CDSL, NSDL, Broker
    account: str  # folio no. / demat account / "Groww"
    asset_class: str
    name: str
    units: float
    value: float  # current market value as per statement (or refreshed)
    isin: Optional[str] = None
    symbol: Optional[str] = None
    amc: Optional[str] = None
    invested: Optional[float] = None  # cost basis if the statement provides it
    price: Optional[float] = None  # NAV / LTP
    as_of: Optional[str] = None  # ISO date of valuation
    price_source: str = "statement"
    import_id: Optional[str] = None
    extra: dict = field(default_factory=dict)

    @property
    def gain(self) -> Optional[float]:
        return None if self.invested is None else self.value - self.invested

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Holding":
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        return cls(**known)


@dataclass
class CashFlow:
    """A dated cash flow for XIRR: negative = money invested, positive = money received."""

    date: str
    amount: float
    isin: Optional[str] = None
    account: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ImportResult:
    kind: str  # e.g. "CAMS CAS", "Groww Stocks"
    holdings: list[Holding]
    cashflows: list[CashFlow] = field(default_factory=list)
    investor: Optional[str] = None
    statement_date: Optional[str] = None
    warnings: list[str] = field(default_factory=list)

"""Merge holdings from every source into one portfolio: remove overlaps, apply live prices, summarise."""
from __future__ import annotations

from dataclasses import replace
from datetime import date
from typing import Iterable, Optional

import pandas as pd

from . import models as m
from .reference import normalize_folio

# Lower = more authoritative when the same holding shows up in several statements.
_MF_PRIORITY = {"CAMS": 0, "KFintech": 0, "Groww": 1, "Broker": 2, "CDSL": 3, "NSDL": 3}
_STOCK_PRIORITY = {"Groww": 0, "Broker": 0, "CDSL": 1, "NSDL": 1}


def _units_match(a: float, b: float) -> bool:
    return abs(a - b) <= max(0.01, 0.005 * max(abs(a), abs(b)))


def _same_holding(a: m.Holding, b: m.Holding) -> bool:
    if a.import_id == b.import_id and a.import_id is not None:
        return False
    if not _units_match(a.units, b.units):
        return False
    is_mf_a, is_mf_b = a.asset_class in m.MF_CLASSES, b.asset_class in m.MF_CLASSES
    if is_mf_a != is_mf_b:
        return False
    if a.isin and b.isin and a.isin != b.isin:
        return False
    if is_mf_a:
        fa, fb = normalize_folio(a.account), normalize_folio(b.account)
        if fa and fb:
            return fa == fb
        return bool(a.isin and a.isin == b.isin)
    if a.isin and b.isin:
        return True
    return bool(a.symbol and b.symbol and a.symbol.upper() == b.symbol.upper())


def dedupe(holdings: Iterable[m.Holding]) -> tuple[list[m.Holding], list[tuple[m.Holding, m.Holding]]]:
    """Returns (kept, [(dropped, kept_instead), ...]).

    The same fund/stock often appears twice, e.g. a Groww mutual fund is also in your CAMS CAS,
    and Groww stocks also appear in your CDSL CAS. We keep the richest record (one with cost basis,
    from the most authoritative source) and drop the copy."""
    def rank(h: m.Holding):
        table = _MF_PRIORITY if h.asset_class in m.MF_CLASSES else _STOCK_PRIORITY
        return (h.invested is None, table.get(h.source, 5), -(date.fromisoformat(h.as_of).toordinal()
                                                               if h.as_of and len(h.as_of) == 10 else 0))

    kept: list[m.Holding] = []
    dropped: list[tuple[m.Holding, m.Holding]] = []
    for h in sorted(holdings, key=rank):
        match = next((k for k in kept if _same_holding(h, k)), None)
        if match is None:
            kept.append(h)
        else:
            dropped.append((h, match))
            # Backfill fields the richer record lacks
            if match.isin is None and h.isin:
                match.isin = h.isin
            if match.symbol is None and h.symbol:
                match.symbol = h.symbol
    return kept, dropped


def price_key(h: m.Holding) -> Optional[str]:
    return h.isin or (h.symbol.upper() if h.symbol else None)


def apply_prices(holdings: Iterable[m.Holding], prices: dict[str, dict]) -> list[m.Holding]:
    """Revalue holdings with refreshed prices that are newer than the statement's valuation date."""
    out = []
    for h in holdings:
        q = prices.get(price_key(h) or "")
        if q and q.get("price") and h.units and (not h.as_of or (q.get("date") or "") >= h.as_of):
            h = replace(h, price=q["price"], value=h.units * q["price"], as_of=q.get("date") or h.as_of,
                        price_source=q.get("source", "live"))
        out.append(h)
    return out


def to_frame(holdings: Iterable[m.Holding]) -> pd.DataFrame:
    rows = []
    for h in holdings:
        rows.append({
            "Name": h.name, "Asset class": h.asset_class, "Source": h.source, "Account": h.account,
            "AMC": h.amc, "ISIN": h.isin, "Symbol": h.symbol, "Units": h.units, "Price": h.price,
            "Invested": h.invested, "Value": h.value, "Gain": h.gain,
            "Return %": (h.gain / h.invested * 100) if h.invested else None,
            "As of": h.as_of, "Price source": h.price_source,
        })
    cols = ["Name", "Asset class", "Source", "Account", "AMC", "ISIN", "Symbol", "Units", "Price",
            "Invested", "Value", "Gain", "Return %", "As of", "Price source"]
    return pd.DataFrame(rows, columns=cols)


def totals(df: pd.DataFrame) -> dict:
    value = float(df["Value"].sum()) if len(df) else 0.0
    with_cost = df[df["Invested"].notna()]
    invested = float(with_cost["Invested"].sum()) if len(with_cost) else 0.0
    cost_value = float(with_cost["Value"].sum()) if len(with_cost) else 0.0
    return {
        "value": value,
        "invested": invested,
        "gain": cost_value - invested,
        "gain_pct": (cost_value - invested) / invested * 100 if invested else None,
        "value_without_cost": value - cost_value,  # holdings whose statement has no cost basis
        "count": len(df),
    }


def group(df: pd.DataFrame, by: str) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=[by, "Value", "Invested", "Gain", "Share %"])
    g = df.groupby(by, dropna=False).agg(Value=("Value", "sum"), Invested=("Invested", "sum"),
                                         Holdings=("Name", "count")).reset_index()
    g["Share %"] = g["Value"] / g["Value"].sum() * 100
    return g.sort_values("Value", ascending=False)


# --- XIRR ------------------------------------------------------------------

def xirr(flows: list[tuple[date, float]]) -> Optional[float]:
    """Annualised internal rate of return for dated cash flows (negative = invested)."""
    flows = [(d, a) for d, a in flows if a]
    if not flows or not any(a < 0 for _, a in flows) or not any(a > 0 for _, a in flows):
        return None
    t0 = min(d for d, _ in flows)
    years = [((d - t0).days / 365.0, a) for d, a in flows]

    def npv(r: float) -> float:
        return sum(a / (1 + r) ** t for t, a in years)

    lo, hi = -0.9999, 10.0
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-6:
            break
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return mid


def mf_xirr(cashflows: list[tuple[str, m.CashFlow]], holdings: list[m.Holding], today: Optional[date] = None
            ) -> Optional[float]:
    """XIRR over mutual funds for which we have full transaction history (detailed CAS)."""
    import_ids = {iid for iid, _ in cashflows}
    if not import_ids:
        return None
    today = today or date.today()
    flows = [(date.fromisoformat(c.date), c.amount) for _, c in cashflows if c.date and len(c.date) == 10]
    terminal = sum(h.value for h in holdings if h.import_id in import_ids)
    flows.append((today, terminal))
    return xirr(flows)

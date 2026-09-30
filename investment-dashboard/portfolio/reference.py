"""Offline ISIN metadata (scheme category, stock symbol) from the casparser-isin database."""
from __future__ import annotations

import re
import sqlite3
from functools import lru_cache
from typing import Optional

from . import models as m

_HYBRID_WORDS = ("hybrid", "balanced", "arbitrage", "equity savings", "multi asset", "asset allocation")
_DEBT_WORDS = (
    "debt", "liquid", "overnight", "gilt", "bond", "money market", "duration", "floater",
    "credit risk", "banking and psu", "banking & psu", "income", "treasury", "fixed maturity", "fmp",
)
_EQUITY_WORDS = (
    "equity", "elss", "tax saver", "cap", "index", "nifty", "sensex", "flexi", "focused", "value",
    "contra", "dividend yield", "sectoral", "thematic", "infrastructure", "pharma", "technology",
    "banking", "consumption", "bluechip", "growth fund", "opportunities", "etf",
)


@lru_cache(maxsize=1)
def _db() -> Optional[sqlite3.Connection]:
    try:
        from casparser_isin.utils import get_isin_db_path

        conn = sqlite3.connect(f"file:{get_isin_db_path()}?mode=ro", uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        return None


@lru_cache(maxsize=4096)
def mf_info(isin: Optional[str]) -> dict:
    """Scheme metadata for an MF ISIN: name, amfi_code, type (EQUITY/DEBT), sebi_category."""
    db = _db()
    if not isin or db is None:
        return {}
    row = db.execute(
        "SELECT name, amfi_code, type, sebi_category FROM scheme WHERE isin = ? LIMIT 1", (isin,)
    ).fetchone()
    return dict(row) if row else {}


@lru_cache(maxsize=4096)
def security_info(isin: Optional[str]) -> dict:
    """Listed security metadata for an ISIN: name, type, symbol, exchange."""
    db = _db()
    if not isin or db is None:
        return {}
    row = db.execute(
        "SELECT name, issuer, type, symbol, exchange FROM isin WHERE isin = ? LIMIT 1", (isin,)
    ).fetchone()
    return dict(row) if row else {}


def classify_mf(name: str = "", isin: Optional[str] = None, hint: Optional[str] = None) -> str:
    """Map a mutual fund to Equity / Debt / Hybrid / Other using category text, then name keywords."""
    info = mf_info(isin)
    texts = [hint or "", info.get("sebi_category") or "", name or ""]
    for text in texts:
        t = text.lower()
        if not t:
            continue
        if any(w in t for w in _HYBRID_WORDS):
            return m.HYBRID_MF
        if t.startswith("debt") or any(w in t for w in _DEBT_WORDS):
            return m.DEBT_MF
        if any(w in t for w in _EQUITY_WORDS):
            return m.EQUITY_MF
        if "gold" in t or "silver" in t or "fof" in t or "fund of fund" in t:
            return m.OTHER_MF
    kind = (info.get("type") or "").upper()
    if kind == "EQUITY":
        return m.EQUITY_MF
    if kind == "DEBT":
        return m.DEBT_MF
    return m.OTHER_MF


def classify_security(name: str = "", isin: Optional[str] = None) -> str:
    """Stocks vs ETFs vs bonds for demat holdings."""
    info = security_info(isin)
    kind = (info.get("type") or "").upper()
    n = (name or info.get("name") or "").upper()
    if isin and isin.startswith("INF") or re.search(r"\bETF\b|BEES\b", n):
        return m.ETF
    if any(k in kind for k in ("BOND", "DEBENTURE", "GOVERNMENT", "SOVEREIGN")):
        return m.BOND
    return m.STOCK


def stock_symbol(isin: Optional[str]) -> Optional[str]:
    return security_info(isin).get("symbol")


def normalize_folio(folio: Optional[str]) -> str:
    """'12345678 / 90' and '12345678/90' and '12345678' all compare equal on the base folio."""
    if not folio:
        return ""
    base = str(folio).split("/")[0]
    return re.sub(r"\D", "", base).lstrip("0")

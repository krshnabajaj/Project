"""Live price refresh: mutual fund NAVs from AMFI, stock/ETF prices from Yahoo Finance (NSE, then BSE)."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Iterable

import requests

AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
_HEADERS = {"User-Agent": "Mozilla/5.0 (investment-dashboard)"}


def parse_amfi(text: str) -> dict[str, dict]:
    """AMFI NAVAll.txt -> {isin: {price, date, source}}.
    Rows: Scheme Code;ISIN Growth/Payout;ISIN Reinvest;Scheme Name;NAV;Date"""
    out: dict[str, dict] = {}
    for line in text.splitlines():
        parts = line.split(";")
        if len(parts) < 6:
            continue
        try:
            nav = float(parts[4])
            day = datetime.strptime(parts[5].strip(), "%d-%b-%Y").date().isoformat()
        except ValueError:
            continue
        for isin in (parts[1].strip(), parts[2].strip()):
            if len(isin) == 12:
                out[isin] = {"price": nav, "date": day, "source": "AMFI"}
    return out


def fetch_mf_navs(isins: Iterable[str], timeout: int = 30) -> dict[str, dict]:
    wanted = {i for i in isins if i}
    if not wanted:
        return {}
    resp = requests.get(AMFI_URL, headers=_HEADERS, timeout=timeout)
    resp.raise_for_status()
    return {k: v for k, v in parse_amfi(resp.text).items() if k in wanted}


def _yahoo_quote(symbol: str, timeout: int = 15) -> dict | None:
    for suffix in (".NS", ".BO"):
        try:
            r = requests.get(YAHOO_URL.format(symbol=symbol + suffix), headers=_HEADERS,
                             params={"range": "1d", "interval": "1d"}, timeout=timeout)
            if r.status_code != 200:
                continue
            meta = r.json()["chart"]["result"][0]["meta"]
            price = meta.get("regularMarketPrice")
            if price:
                ts = meta.get("regularMarketTime")
                day = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat() if ts else None
                return {"price": float(price), "date": day, "source": f"Yahoo {suffix[1:]}"}
        except (requests.RequestException, KeyError, IndexError, TypeError, ValueError):
            continue
    return None


def fetch_stock_prices(symbols: dict[str, str]) -> dict[str, dict]:
    """symbols: {key (isin or symbol): trading symbol} -> {key: quote}"""
    if not symbols:
        return {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = pool.map(lambda kv: (kv[0], _yahoo_quote(kv[1])), symbols.items())
        return {k: q for k, q in results if q}

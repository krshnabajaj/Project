"""Spreadsheet holdings exports: Groww (stocks & mutual funds) and generic broker CSV/XLSX
(Zerodha Console, Upstox, Angel One, ICICI Direct, ... anything with a name + quantity/value table)."""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd

from .. import models as m
from ..reference import classify_mf, classify_security, stock_symbol

# Column aliases, most specific first. Matching is on normalised header text.
ALIASES: dict[str, list[str]] = {
    "name": ["stock name", "scheme name", "fund name", "security name", "company name", "instrument",
             "scrip name", "scrip", "symbol", "trading symbol", "name"],
    "isin": ["isin", "isin code"],
    "units": ["quantity", "qty", "units", "balance units", "quantity available", "total quantity",
              "free quantity", "no of shares", "shares"],
    "avg_price": ["average buy price", "average price", "avg cost", "avg price", "avg buy price", "buy avg",
                  "average cost"],
    "invested": ["buy value", "invested value", "invested amount", "investment value", "invested",
                 "cost value", "total cost", "purchase value"],
    "price": ["closing price", "ltp", "current price", "last price", "close price", "market price", "nav",
              "current nav", "previous closing price"],
    "value": ["closing value", "current value", "cur val", "market value", "present value", "value at ltp",
              "current market value"],
    "folio": ["folio no", "folio number", "folio"],
    "amc": ["amc", "amc name", "fund house"],
    "category": ["sub category", "category", "scheme category"],
    "xirr": ["xirr"],
}
REQUIRED_ANY = ("units", "value", "invested")


def _norm(x) -> str:
    s = str(x).strip().lower() if x is not None and not (isinstance(x, float) and pd.isna(x)) else ""
    s = re.sub(r"\(.*?\)|[^a-z0-9 ]", " ", s.replace("-", " "))
    return re.sub(r"\s+", " ", s).strip()


def _to_float(x) -> Optional[float]:
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = re.sub(r"[₹,\s%]", "", str(x))
    if s in ("", "-", "--", "nan"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _map_header(cells: list) -> dict[str, int]:
    normed = [_norm(c) for c in cells]
    mapping: dict[str, int] = {}
    used: set[int] = set()
    for field, aliases in ALIASES.items():
        # Exact match first, then prefix match (e.g. "quantity available" vs "quantity")
        for alias in aliases:
            idx = next((i for i, c in enumerate(normed) if c == alias and i not in used), None)
            if idx is None:
                idx = next((i for i, c in enumerate(normed) if c.startswith(alias + " ") and i not in used), None)
            if idx is not None:
                mapping[field] = idx
                used.add(idx)
                break
    return mapping


def _find_table(raw: pd.DataFrame) -> tuple[int, dict[str, int]] | None:
    for r in range(min(len(raw), 60)):
        mapping = _map_header(list(raw.iloc[r]))
        if "name" in mapping and any(k in mapping for k in REQUIRED_ANY):
            return r, mapping
    return None


def _as_of_date(raw: pd.DataFrame, header_row: int) -> Optional[str]:
    text = " ".join(str(v) for v in raw.iloc[:header_row].to_numpy().ravel() if isinstance(v, str))
    match = re.search(r"(?:as on|as of|date)[:\s-]*(\d{1,4}[-/ ][A-Za-z0-9]{1,9}[-/ ]\d{2,4})", text, re.I)
    if not match:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%d %B %Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(match.group(1), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _read_sheets(path: Path, filename: str) -> list[pd.DataFrame]:
    if filename.lower().endswith(".csv"):
        return [pd.read_csv(path, header=None, dtype=object, skip_blank_lines=False,
                            on_bad_lines="skip", engine="python")]
    return list(pd.read_excel(path, header=None, sheet_name=None, dtype=object).values())


def parse_tabular(path: str | Path, filename: Optional[str] = None, source: Optional[str] = None) -> m.ImportResult:
    path = Path(path)
    filename = filename or path.name
    for raw in _read_sheets(path, filename):
        found = _find_table(raw)
        if found:
            break
    else:
        raise ValueError(
            f"{filename}: couldn't find a holdings table (need columns like Name + Quantity/Units/Value)"
        )
    header_row, cols = found
    header_blob = " ".join(str(v) for v in raw.iloc[: header_row + 1].to_numpy().ravel() if isinstance(v, str))
    if source is None:
        source = "Groww" if "groww" in (filename + " " + header_blob).lower() else "Broker"
    is_mf = "folio" in cols or any(
        k in _norm(raw.iat[header_row, cols["name"]]) for k in ("scheme", "fund")
    )
    as_of = _as_of_date(raw, header_row) or datetime.now().date().isoformat()

    def cell(row, field):
        idx = cols.get(field)
        return None if idx is None else row[idx]

    holdings: list[m.Holding] = []
    warnings: list[str] = []
    for _, row in raw.iloc[header_row + 1:].iterrows():
        row = list(row)
        name = cell(row, "name")
        if name is None or (isinstance(name, float) and pd.isna(name)) or not str(name).strip():
            if holdings:
                break  # end of table
            continue
        name = str(name).strip()
        if _norm(name) in ("total", "grand total") or _norm(name).startswith("total "):
            continue
        units = _to_float(cell(row, "units"))
        price = _to_float(cell(row, "price"))
        value = _to_float(cell(row, "value"))
        invested = _to_float(cell(row, "invested"))
        avg = _to_float(cell(row, "avg_price"))
        if invested is None and avg is not None and units is not None:
            invested = avg * units
        if value is None and price is not None and units is not None:
            value = price * units
        if price is None and value is not None and units:
            price = value / units
        if value is None:
            warnings.append(f"Skipped '{name}': no current value or price")
            continue
        if units is not None and units <= 0:
            continue
        isin = cell(row, "isin")
        isin = str(isin).strip().upper() if isin is not None and str(isin).strip() not in ("", "nan") else None
        if is_mf:
            folio = cell(row, "folio")
            holdings.append(m.Holding(
                source=source,
                account=str(folio).strip() if folio is not None and str(folio) != "nan" else source,
                asset_class=classify_mf(name, isin, _str(cell(row, "category"))),
                name=name, isin=isin, amc=_str(cell(row, "amc")),
                units=units or 0.0, price=price, value=value, invested=invested, as_of=as_of,
                extra={k: v for k, v in {"xirr": _to_float(cell(row, "xirr"))}.items() if v is not None},
            ))
        else:
            symbol = stock_symbol(isin) or (name if re.fullmatch(r"[A-Z0-9&\-]+", name) else None)
            holdings.append(m.Holding(
                source=source, account=source,
                asset_class=classify_security(name, isin),
                name=name, isin=isin, symbol=symbol,
                units=units or 0.0, price=price, value=value, invested=invested, as_of=as_of,
            ))
    kind = f"{source} {'Mutual Funds' if is_mf else 'Stocks'}"
    return m.ImportResult(kind=kind, holdings=holdings, statement_date=as_of, warnings=warnings)


def _str(x) -> Optional[str]:
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return None
    return str(x).strip() or None

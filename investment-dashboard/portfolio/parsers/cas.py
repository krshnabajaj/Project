"""CAMS / KFintech (MyCAMS, KFinKart) and NSDL / CDSL consolidated account statements, via casparser."""
from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any

from .. import models as m
from ..reference import classify_mf, classify_security

_OUTFLOW = {"PURCHASE", "PURCHASE_SIP", "SWITCH_IN", "SWITCH_IN_MERGER", "STAMP_DUTY_TAX"}
_INFLOW = {"REDEMPTION", "SWITCH_OUT", "SWITCH_OUT_MERGER", "DIVIDEND_PAYOUT"}


def _num(x: Any) -> float | None:
    return None if x is None else float(x)


def _iso(d: Any) -> str | None:
    if d is None:
        return None
    if isinstance(d, date):
        return d.isoformat()
    s = str(d).strip()
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return s


def parse_cas_pdf(path: str | Path, password: str) -> m.ImportResult:
    import casparser

    data = casparser.read_cas_pdf(str(path), password)
    file_type = str(getattr(data, "file_type", "UNKNOWN"))
    if hasattr(data, "folios"):
        return _from_rta_cas(data, file_type)
    return _from_depository_cas(data, file_type)


def _from_rta_cas(data, file_type: str) -> m.ImportResult:
    """CAMS/KFintech CAS: every mutual fund folio across all AMCs, incl. transactions."""
    issuer = "KFintech" if file_type == "KFINTECH" else "CAMS"
    holdings: list[m.Holding] = []
    flows: list[m.CashFlow] = []
    for folio in data.folios:
        for s in folio.schemes:
            units = float(s.close)
            isin = s.isin or None
            for t in s.transactions:
                ttype = str(getattr(t.type, "value", t.type))
                if t.amount is None or ttype not in _OUTFLOW | _INFLOW:
                    continue
                amt = abs(float(t.amount))
                flows.append(
                    m.CashFlow(
                        date=_iso(t.date),
                        amount=-amt if ttype in _OUTFLOW else amt,
                        isin=isin,
                        account=folio.folio,
                    )
                )
            if units <= 0.0005:
                continue
            v = s.valuation
            holdings.append(
                m.Holding(
                    source=issuer,
                    account=folio.folio,
                    asset_class=classify_mf(s.scheme, isin, s.type),
                    name=s.scheme,
                    isin=isin,
                    amc=folio.amc,
                    units=units,
                    price=_num(v.nav),
                    value=float(v.value),
                    invested=_num(v.cost),
                    as_of=_iso(v.date),
                    extra={"amfi": s.amfi, "advisor": s.advisor, "rta": s.rta},
                )
            )
    return m.ImportResult(
        kind=f"{issuer} CAS ({data.cas_type})",
        holdings=holdings,
        cashflows=flows,
        investor=data.investor_info.name,
        statement_date=_iso(data.statement_period.to),
        warnings=list(getattr(data, "parse_warnings", []) or []),
    )


def _from_depository_cas(data, file_type: str) -> m.ImportResult:
    """NSDL/CDSL CAS: demat equities, ETFs, bonds, MF units in demat, and NPS."""
    source = "NSDL" if file_type == "NSDL" else "CDSL"
    as_of = _iso(data.statement_period.to)
    holdings: list[m.Holding] = []
    for acct in data.accounts:
        label = f"{acct.name} {acct.dp_id or ''}{acct.client_id or ''}".strip()
        for e in acct.equities:
            if float(e.num_shares) <= 0:
                continue
            holdings.append(
                m.Holding(
                    source=source,
                    account=label,
                    asset_class=classify_security(e.name or "", e.isin),
                    name=e.name or e.isin,
                    isin=e.isin,
                    symbol=e.symbol,
                    units=float(e.num_shares),
                    price=_num(e.price),
                    value=float(e.value),
                    as_of=as_of,
                )
            )
        for f in acct.mutual_funds:
            if float(f.balance) <= 0:
                continue
            holdings.append(
                m.Holding(
                    source=source,
                    account=f.folio or label,
                    asset_class=classify_mf(f.name or "", f.isin, f.type),
                    name=f.name or f.isin,
                    isin=f.isin,
                    units=float(f.balance),
                    price=_num(f.nav),
                    value=float(f.value),
                    invested=_num(f.total_cost),
                    as_of=as_of,
                    extra={"in_demat": True, "demat_account": label},
                )
            )
        for b in acct.bonds:
            holdings.append(
                m.Holding(
                    source=source,
                    account=label,
                    asset_class=m.BOND,
                    name=b.name or b.isin,
                    isin=b.isin,
                    units=float(b.num_bonds),
                    price=_num(b.market_price),
                    value=float(b.value),
                    as_of=as_of,
                )
            )
    nps = getattr(data, "nps", None)
    if nps:
        for s in nps.schemes:
            holdings.append(
                m.Holding(
                    source=source,
                    account=f"NPS {nps.pran or ''}".strip(),
                    asset_class=m.NPS,
                    name=s.scheme,
                    units=float(s.units),
                    price=_num(s.nav),
                    value=float(s.value),
                    as_of=as_of,
                )
            )
    return m.ImportResult(
        kind=f"{source} CAS",
        holdings=holdings,
        investor=data.investor_info.name,
        statement_date=as_of,
        warnings=list(getattr(data, "parse_warnings", []) or []),
    )

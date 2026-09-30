"""Fictional sample statements so you can try the dashboard before importing your own."""
from __future__ import annotations

from datetime import date, timedelta

from . import models as m


def demo_imports(today: date | None = None) -> list[tuple[m.ImportResult, str]]:
    today = today or date.today()
    d = today.isoformat()
    cams = m.ImportResult(
        kind="CAMS CAS (DETAILED)", investor="DEMO INVESTOR", statement_date=d,
        holdings=[
            m.Holding("CAMS", "1234567/89", m.EQUITY_MF, "Parag Parikh Flexi Cap Fund - Direct Growth",
                      units=2150.412, value=190_450.0, invested=120_000.0, price=88.57, isin="INF879O01027",
                      amc="PPFAS Mutual Fund", as_of=d),
            m.Holding("CAMS", "9988776", m.EQUITY_MF, "Axis ELSS Tax Saver Fund - Direct Growth",
                      units=1780.0, value=172_300.0, invested=150_000.0, price=96.8, isin="INF846K01EW2",
                      amc="Axis Mutual Fund", as_of=d),
            m.Holding("KFintech", "55001122", m.HYBRID_MF, "ICICI Prudential Balanced Advantage - Direct Growth",
                      units=1502.3, value=118_900.0, invested=100_000.0, price=79.14, isin="INF109K01BH2",
                      amc="ICICI Prudential Mutual Fund", as_of=d),
            m.Holding("CAMS", "4455667", m.DEBT_MF, "HDFC Short Term Debt Fund - Direct Growth",
                      units=6120.5, value=205_600.0, invested=180_000.0, price=33.59, isin="INF179K01XQ0",
                      amc="HDFC Mutual Fund", as_of=d),
            m.Holding("CAMS", "7788990", m.EQUITY_MF, "Nippon India Small Cap Fund - Direct Growth",
                      units=720.1, value=141_200.0, invested=90_000.0, price=196.1, isin="INF204K01K15",
                      amc="Nippon India Mutual Fund", as_of=d),
        ],
    )
    # Monthly SIPs over three years so XIRR has something to chew on
    start = today - timedelta(days=3 * 365)
    for i in range(36):
        day = (start + timedelta(days=30 * i)).isoformat()
        cams.cashflows.append(m.CashFlow(day, -17_777.78, account="demo"))
    groww_mf = m.ImportResult(
        kind="Groww Mutual Funds", statement_date=d,
        holdings=[
            # Same folio/units as the CAMS entry above -> shown once (overlap is removed)
            m.Holding("Groww", "1234567/89", m.EQUITY_MF, "Parag Parikh Flexi Cap Fund Direct Growth",
                      units=2150.412, value=190_450.0, invested=120_000.0, as_of=d, amc="PPFAS"),
            m.Holding("Groww", "91029384", m.EQUITY_MF, "Motilal Oswal Nasdaq 100 FOF Direct Growth",
                      units=2400.0, value=96_500.0, invested=70_000.0, as_of=d, amc="Motilal Oswal"),
        ],
    )
    groww_stocks = m.ImportResult(
        kind="Groww Stocks", statement_date=d,
        holdings=[
            m.Holding("Groww", "Groww", m.STOCK, "Reliance Industries", units=40, value=118_000.0,
                      invested=96_000.0, price=2950.0, isin="INE002A01018", symbol="RELIANCE", as_of=d),
            m.Holding("Groww", "Groww", m.STOCK, "Infosys", units=60, value=112_800.0, invested=88_200.0,
                      price=1880.0, isin="INE009A01021", symbol="INFY", as_of=d),
            m.Holding("Groww", "Groww", m.STOCK, "HDFC Bank", units=55, value=93_500.0, invested=86_900.0,
                      price=1700.0, isin="INE040A01034", symbol="HDFCBANK", as_of=d),
        ],
    )
    cdsl = m.ImportResult(
        kind="CDSL CAS", investor="DEMO INVESTOR", statement_date=d,
        holdings=[
            # Also held via Groww (same ISIN + qty) -> de-duplicated
            m.Holding("CDSL", "Zerodha 1208160000000000", m.STOCK, "RELIANCE INDUSTRIES LIMITED", units=40,
                      value=118_000.0, price=2950.0, isin="INE002A01018", symbol="RELIANCE", as_of=d),
            m.Holding("CDSL", "Zerodha 1208160000000000", m.STOCK, "TATA CONSULTANCY SERVICES LTD", units=25,
                      value=102_500.0, price=4100.0, isin="INE467B01029", symbol="TCS", as_of=d),
            m.Holding("CDSL", "Zerodha 1208160000000000", m.ETF, "NIPPON INDIA ETF GOLD BEES", units=1500,
                      value=97_500.0, price=65.0, isin="INF204KB17I5", symbol="GOLDBEES", as_of=d),
            m.Holding("CDSL", "Zerodha 1208160000000000", m.BOND, "SOVEREIGN GOLD BOND 2021-22 SR-VIII",
                      units=10, value=74_000.0, price=7400.0, isin="IN0020210186", as_of=d),
        ],
    )
    return [(cams, "demo-cams-cas.pdf"), (groww_mf, "demo-groww-mf.xlsx"),
            (groww_stocks, "demo-groww-stocks.xlsx"), (cdsl, "demo-cdsl-cas.pdf")]

from datetime import date

import pytest

from portfolio import aggregate as agg
from portfolio import models as m
from portfolio.demo import demo_imports
from portfolio.prices import parse_amfi
from portfolio.store import Store


def H(source, account, cls, units, value, invested=None, isin=None, symbol=None, iid=None, as_of="2026-09-01"):
    h = m.Holding(source, account, cls, "x", units=units, value=value, invested=invested, isin=isin,
                  symbol=symbol, as_of=as_of)
    h.import_id = iid or source
    return h


def test_groww_mf_duplicate_of_cams_by_folio():
    cams = H("CAMS", "1234567 / 89", m.EQUITY_MF, 100.0, 5000, 4000, isin="INF1")
    groww = H("Groww", "1234567/89", m.EQUITY_MF, 100.0, 5000, 4000)
    kept, dropped = agg.dedupe([groww, cams])
    assert kept == [cams] and dropped == [(groww, cams)]


def test_same_fund_different_folio_is_not_duplicate():
    a = H("CAMS", "111", m.EQUITY_MF, 100.0, 5000, 4000, isin="INF1")
    b = H("Groww", "222", m.EQUITY_MF, 100.0, 5000, 4000)
    kept, dropped = agg.dedupe([a, b])
    assert len(kept) == 2 and not dropped


def test_groww_stock_in_cdsl_keeps_record_with_cost():
    cdsl = H("CDSL", "dp", m.STOCK, 40, 118000, isin="INE002A01018")
    groww = H("Groww", "Groww", m.STOCK, 40, 118000, 96000, isin="INE002A01018")
    kept, dropped = agg.dedupe([cdsl, groww])
    assert kept == [groww] and dropped[0][0] is cdsl


def test_different_quantity_is_not_duplicate():
    a = H("CDSL", "dp", m.STOCK, 40, 118000, isin="INE002A01018")
    b = H("Groww", "Groww", m.STOCK, 10, 29500, 24000, isin="INE002A01018")
    assert len(agg.dedupe([a, b])[0]) == 2


def test_apply_prices_only_when_newer():
    h = H("CAMS", "1", m.EQUITY_MF, 10, 100, isin="INF1", as_of="2026-09-01")
    newer = agg.apply_prices([h], {"INF1": {"price": 12, "date": "2026-09-30", "source": "AMFI"}})[0]
    older = agg.apply_prices([h], {"INF1": {"price": 12, "date": "2026-08-01", "source": "AMFI"}})[0]
    assert newer.value == 120 and newer.price_source == "AMFI"
    assert older.value == 100


def test_xirr_simple_doubling():
    r = agg.xirr([(date(2020, 1, 1), -100), (date(2021, 1, 1), 110)])
    assert r == pytest.approx(0.0997, abs=1e-3)  # 366-day year
    assert agg.xirr([(date(2020, 1, 1), -100)]) is None


def test_parse_amfi():
    text = ("Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date\n\n"
            "Open Ended Schemes(Equity Scheme - ELSS)\n\n"
            "120503;INF846K01EW2;-;Axis ELSS Tax Saver Fund - Direct Plan - Growth;96.1234;29-Sep-2026\n")
    assert parse_amfi(text) == {"INF846K01EW2": {"price": 96.1234, "date": "2026-09-29", "source": "AMFI"}}


def test_store_replaces_same_statement_and_demo_totals(tmp_path):
    store = Store(tmp_path / "p.json")
    for res, name in demo_imports(date(2026, 9, 30)):
        store.add_import(res, name)
    first_cams = demo_imports(date(2026, 9, 30))[0]
    store.add_import(*first_cams)  # re-import newer CAMS CAS -> replaces, not duplicates
    store.save()
    store = Store(tmp_path / "p.json")
    assert len(store.imports) == 4
    kept, dropped = agg.dedupe(store.holdings())
    assert len(dropped) == 2  # PPFAS via Groww, Reliance via CDSL
    df = agg.to_frame(kept)
    assert agg.totals(df)["count"] == 12
    rate = agg.mf_xirr(store.cashflows(), store.holdings(), today=date(2026, 9, 30))
    assert rate is not None and 0.05 < rate < 0.5

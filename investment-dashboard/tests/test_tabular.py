import pandas as pd
import pytest

from portfolio import models as m
from portfolio.parsers import parse_file


def _xlsx(path, rows):
    pd.DataFrame(rows).to_excel(path, header=False, index=False)
    return path


def test_groww_stocks_export(tmp_path):
    rows = [
        ["Name", "Demo User"],
        ["Unique Client Code", "1234567"],
        ["Holdings statement as on 2026-09-29"],
        [],
        ["Stock Name", "ISIN", "Quantity", "Average buy price", "Buy value", "Closing price", "Closing value",
         "Unrealised P&L"],
        ["RELIANCE INDUSTRIES LTD", "INE002A01018", 10, 2400, 24000, 2950.5, 29505, 5505],
        ["NIPPON INDIA ETF NIFTY BEES", "INF204KB14I2", "100", "250.00", "25,000.00", "280", "28,000", "3000"],
        [],
        ["Total", None, None, None, 49000, None, 57505],
    ]
    res = parse_file(_xlsx(tmp_path / "Stocks_Holdings_Statement.xlsx", rows), filename="Groww_Stocks.xlsx")
    assert res.kind == "Groww Stocks"
    assert res.statement_date == "2026-09-29"
    assert len(res.holdings) == 2
    rel, etf = res.holdings
    assert rel.source == "Groww" and rel.asset_class == m.STOCK and rel.symbol == "RELIANCE"
    assert rel.units == 10 and rel.invested == 24000 and rel.value == 29505
    assert etf.asset_class == m.ETF and etf.invested == 25000


def test_groww_mutual_funds_export(tmp_path):
    rows = [
        ["Name", "Demo User"],
        ["Holdings as on 29-09-2026"],
        ["Scheme Name", "AMC", "Category", "Sub-category", "Folio No.", "Source", "Units", "Invested Value",
         "Current Value", "Returns", "XIRR"],
        ["Parag Parikh Flexi Cap Fund Direct Growth", "PPFAS", "Equity", "Flexi Cap Fund", "1234567/89",
         "Groww", 2150.412, 120000, 190450, 70450, "18.2%"],
        ["HDFC Liquid Fund Direct Growth", "HDFC", "Debt", "Liquid Fund", "4455667", "Groww", 10.5, 50000,
         52000, 2000, "7.1%"],
    ]
    res = parse_file(_xlsx(tmp_path / "mf.xlsx", rows), filename="Mutual_Funds_groww.xlsx")
    assert res.kind == "Groww Mutual Funds"
    assert res.statement_date == "2026-09-29"
    ppfas, liquid = res.holdings
    assert ppfas.asset_class == m.EQUITY_MF and ppfas.account == "1234567/89" and ppfas.extra["xirr"] == 18.2
    assert liquid.asset_class == m.DEBT_MF and liquid.value == 52000


def test_zerodha_console_csv(tmp_path):
    p = tmp_path / "holdings.csv"
    p.write_text(
        "Instrument,Qty.,Avg. cost,LTP,Cur. val,P&L,Net chg.,Day chg.\n"
        "INFY,60,1470.00,1880.00,112800.00,24600.00,27.89,0.5\n"
        "GOLDBEES,1500,50,65,97500,22500,30,0.1\n"
    )
    res = parse_file(p)
    assert res.kind == "Broker Stocks"
    infy, gold = res.holdings
    assert infy.symbol == "INFY" and infy.invested == pytest.approx(88200) and infy.value == 112800
    assert gold.asset_class == m.ETF


def test_unrecognised_sheet_raises(tmp_path):
    with pytest.raises(ValueError):
        parse_file(_xlsx(tmp_path / "x.xlsx", [["foo", "bar"], [1, 2]]))

from casparser.types import CASData, NSDLCASData

from portfolio import models as m
from portfolio.parsers.cas import _from_depository_cas, _from_rta_cas

INVESTOR = {"name": "DEMO", "email": "", "address": "", "mobile": ""}
PERIOD = {"from": "01-Jan-2020", "to": "29-Sep-2026"}


def test_cams_detailed_cas():
    data = CASData.model_validate({
        "statement_period": PERIOD, "investor_info": INVESTOR, "cas_type": "DETAILED", "file_type": "CAMS",
        "folios": [{
            "folio": "1234567 / 89", "amc": "PPFAS Mutual Fund", "schemes": [{
                "scheme": "Parag Parikh Flexi Cap Fund - Direct Plan Growth", "rta_code": "PP01", "rta": "CAMS",
                "type": "EQUITY", "isin": "INF879O01027", "amfi": "122639", "open": "0", "close": "150.5",
                "close_calculated": "150.5",
                "valuation": {"date": "2026-09-29", "nav": "88.5", "value": "13319.25", "cost": "10000"},
                "transactions": [
                    {"date": "2021-01-01", "description": "SIP", "amount": "10000", "units": "300",
                     "type": "PURCHASE_SIP"},
                    {"date": "2022-01-01", "description": "Redemption", "amount": "-5000", "units": "-149.5",
                     "type": "REDEMPTION"},
                ],
            }, {
                "scheme": "Closed out fund", "rta_code": "X", "rta": "CAMS", "open": "0", "close": "0",
                "close_calculated": "0", "valuation": {"date": "2026-09-29", "nav": "10", "value": "0"},
                "transactions": [],
            }],
        }],
    })
    res = _from_rta_cas(data, "CAMS")
    assert res.kind == "CAMS CAS (DETAILED)"
    assert len(res.holdings) == 1  # zero-balance scheme skipped
    h = res.holdings[0]
    assert (h.source, h.asset_class, h.units, h.value, h.invested) == ("CAMS", m.EQUITY_MF, 150.5, 13319.25, 10000)
    assert [c.amount for c in res.cashflows] == [-10000, 5000]


def test_cdsl_cas():
    data = NSDLCASData.model_validate({
        "statement_period": PERIOD, "investor_info": INVESTOR, "file_type": "CDSL",
        "accounts": [{
            "name": "ZERODHA BROKING", "type": "CDSL", "dp_id": "12081600", "client_id": "00001234",
            "folios": 3, "balance": "300000", "owners": [],
            "equities": [{"name": "RELIANCE", "isin": "INE002A01018", "num_shares": "40", "price": "2950",
                          "value": "118000", "symbol": "RELIANCE"},
                         {"name": "NIPPON INDIA ETF GOLD BEES", "isin": "INF204KB17I5", "num_shares": "10",
                          "price": "65", "value": "650"}],
            "mutual_funds": [{"name": "HDFC Liquid", "isin": "INF179KB1HP9", "balance": "2", "nav": "5000",
                              "value": "10000"}],
            "bonds": [{"name": "SGB 2021", "isin": "IN0020210186", "num_bonds": "10", "value": "74000"}],
        }],
    })
    res = _from_depository_cas(data, "CDSL")
    classes = [h.asset_class for h in res.holdings]
    assert classes == [m.STOCK, m.ETF, m.DEBT_MF, m.BOND]
    assert all(h.source == "CDSL" for h in res.holdings)
    assert res.holdings[0].account == "ZERODHA BROKING 1208160000001234"

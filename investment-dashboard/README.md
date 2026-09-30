# Investment Dashboard

All your investments in one place — mutual funds from **MyCAMS / KFintech**, stocks and funds on **Groww**,
and everything in your **demat accounts (CDSL / NSDL)** — merged, de-duplicated, and valued with live prices.

Runs locally. Your statements and holdings never leave your machine (they're stored in `data/portfolio.json`,
which is git-ignored).

## Why statements, not logins?

CAMS, KFintech, Groww, CDSL and NSDL don't offer public APIs for personal holdings, and scraping them with your
password is fragile and risky. Instead the dashboard reads the official statements each of them lets you download
(or emails you monthly). Import them once, refresh prices any time, and re-import a newer statement whenever you
want to update units — a new statement automatically replaces the older one of the same kind.

## What to download

| Source | Where | File |
|---|---|---|
| **MyCAMS** (covers all AMCs) | [mycams.camsonline.com](https://mycams.camsonline.com) → *Statements* → *CAS – CAMS+KFintech* → **Detailed**, period *Since inception* | PDF, password = PAN |
| **KFintech** (alternative) | [mfs.kfintech.com → Consolidated Account Statement](https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement) | PDF |
| **Groww stocks** | Groww app/web → Profile → *Reports* → *Stocks holdings statement* | XLSX |
| **Groww mutual funds** | Groww → Profile → *Reports* → *Mutual funds holdings statement* | XLSX |
| **Demat (CDSL)** | [cdslindia.com](https://www.cdslindia.com) → *CAS*, or the monthly e-CAS email | PDF, password = PAN |
| **Demat (NSDL)** | [nsdlcas.nsdl.com](https://nsdlcas.nsdl.com), or the monthly e-CAS email | PDF, password = PAN (+DOB on some) |
| **Any broker** | Zerodha Console, Upstox, Angel One, ICICI Direct… holdings export | CSV / XLSX |

A detailed CAMS/KFintech CAS includes the full transaction history, which powers the **MF XIRR** figure.
The depository CAS covers shares, ETFs, bonds/SGBs, MF units held in demat, and NPS.

## Run it

```bash
cd investment-dashboard
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

Open http://localhost:8501, then either upload statements from the sidebar or click **Load demo data** to look around.

**Hands-free import:** copy `.env.example` to `.env`, put your PAN in `CAS_PASSWORDS`, drop statements into
`data/inbox/`, and click **Scan inbox folder**.

**Live prices:** *Refresh live prices* pulls the latest NAVs from AMFI and stock/ETF quotes from Yahoo Finance
(NSE, falling back to BSE). Holdings are revalued as `units × latest price`; anything that can't be priced keeps its
statement value.

## What you get

- **Headline numbers:** current value, invested amount, unrealised gain, MF XIRR, holding count
- **Allocation** by asset class (equity / debt / hybrid MFs, stocks, ETFs, bonds, NPS) and by source
- **Top 10 holdings**, per-AMC and per-demat-account breakdowns, full sortable holdings table with CSV export
- **Overlaps:** the same fund or share showing up in two statements (e.g. a Groww fund also in your CAMS CAS, or Groww
  shares also in your CDSL CAS) is counted once — matched on ISIN/folio/quantity, keeping the record with cost basis
- **History:** net worth is recorded daily when you open the dashboard, building a trend over time

## Layout

```
app.py                     Streamlit UI
portfolio/
  parsers/cas.py           CAMS/KFintech + NSDL/CDSL CAS PDFs (via casparser)
  parsers/tabular.py       Groww & broker CSV/XLSX (header auto-detection)
  aggregate.py             de-duplication, live revaluation, totals, XIRR
  prices.py                AMFI NAV + Yahoo Finance quotes
  reference.py             offline ISIN → category/symbol lookup (casparser-isin)
  store.py                 local JSON store
tests/                     pytest suite (`python -m pytest`)
```

If a Groww or broker export isn't recognised, the parser looks for a header row with a name column plus
quantity/value columns; add the column's header text to `ALIASES` in `portfolio/parsers/tabular.py`.

"""Investment Dashboard — every holding from MyCAMS/KFintech CAS, Groww, and your demat (CDSL/NSDL) in one place.

Run:  streamlit run app.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

from portfolio import aggregate as agg
from portfolio import models as m
from portfolio import prices
from portfolio.demo import demo_imports
from portfolio.parsers import parse_file
from portfolio.store import DATA_DIR, Store

INBOX = DATA_DIR / "inbox"

# Fixed colour per asset class (colour follows the entity, not its rank)
CLASS_COLORS = {
    m.EQUITY_MF: "#2a78d6", m.STOCK: "#eb6834", m.DEBT_MF: "#1baf7a", m.HYBRID_MF: "#eda100",
    m.ETF: "#e87ba4", m.BOND: "#008300", m.OTHER_MF: "#4a3aa7", m.NPS: "#e34948",
}
SOURCE_COLORS = {"CAMS": "#2a78d6", "KFintech": "#eb6834", "Groww": "#1baf7a", "CDSL": "#eda100",
                 "NSDL": "#e87ba4", "Broker": "#008300"}

st.set_page_config(page_title="Investment Dashboard", page_icon="📈", layout="wide")


def load_env_passwords() -> list[str]:
    env_file = Path(__file__).parent / ".env"
    values = os.environ.get("CAS_PASSWORDS", "")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.strip().startswith("CAS_PASSWORDS="):
                values = values + "," + line.split("=", 1)[1]
    return [p.strip() for p in values.split(",") if p.strip()]


def inr(x: float | None, short: bool = True) -> str:
    if x is None or pd.isna(x):
        return "—"
    sign = "-" if x < 0 else ""
    x = abs(x)
    if short and x >= 1e7:
        return f"{sign}₹{x / 1e7:.2f} Cr"
    if short and x >= 1e5:
        return f"{sign}₹{x / 1e5:.2f} L"
    # Indian digit grouping: 12,34,567
    s = f"{x:.0f}"
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return f"{sign}₹{','.join(groups + [tail]) if groups else tail}"


def import_files(store: Store, files: list[tuple[Path, str]], passwords: list[str]) -> None:
    for path, name in files:
        try:
            result = parse_file(path, passwords, filename=name)
        except Exception as exc:
            st.sidebar.error(f"❌ {name}: {exc}")
            continue
        store.add_import(result, name)
        msg = f"✅ {name}: {result.kind}, {len(result.holdings)} holdings"
        st.sidebar.success(msg)
        for w in result.warnings[:5]:
            st.sidebar.warning(f"{name}: {w}")
    store.save()


def sidebar(store: Store) -> None:
    sb = st.sidebar
    sb.header("Import statements")
    passwords = load_env_passwords()
    pw = sb.text_input("PDF password (usually your PAN)", type="password",
                       help="CAMS/KFintech & NSDL/CDSL CAS PDFs are encrypted. Nothing leaves your machine.")
    if pw:
        passwords = [pw.strip(), pw.strip().upper()] + passwords
    uploads = sb.file_uploader(
        "CAS PDF, Groww export, or broker holdings", type=["pdf", "xlsx", "xls", "csv"],
        accept_multiple_files=True,
        help="• MyCAMS / KFintech CAS (PDF)\n• Groww Stocks / Mutual Funds holdings (XLSX)\n"
             "• NSDL / CDSL CAS (PDF)\n• Any broker holdings CSV/XLSX (Zerodha, Upstox, …)",
    )
    if uploads and sb.button("Import", type="primary", use_container_width=True):
        with tempfile.TemporaryDirectory() as tmp:
            files = []
            for up in uploads:
                p = Path(tmp) / up.name
                p.write_bytes(up.getvalue())
                files.append((p, up.name))
            import_files(store, files, passwords)

    inbox_files = sorted(p for p in INBOX.glob("*") if p.suffix.lower() in (".pdf", ".xlsx", ".xls", ".csv"))
    if sb.button(f"Scan inbox folder ({len(inbox_files)} files)", use_container_width=True,
                 disabled=not inbox_files, help=f"Drop statements in {INBOX}"):
        import_files(store, [(p, p.name) for p in inbox_files], passwords)

    sb.divider()
    if sb.button("🔄 Refresh live prices", use_container_width=True, disabled=not store.imports,
                 help="Latest NAVs from AMFI and stock/ETF prices from Yahoo Finance (NSE/BSE)"):
        refresh_prices(store)

    sb.divider()
    sb.subheader("Imported statements")
    if not store.imports:
        sb.caption("Nothing yet.")
        if sb.button("Load demo data"):
            for result, name in demo_imports():
                store.add_import(result, name)
            store.save()
            st.rerun()
    for rec in store.imports:
        c1, c2 = sb.columns([5, 1])
        c1.markdown(f"**{rec['kind']}**  \n{rec['filename']} · {len(rec['holdings'])} holdings · "
                    f"as of {rec.get('statement_date') or '—'}")
        if c2.button("🗑️", key=f"rm-{rec['id']}", help="Remove this statement"):
            store.remove_import(rec["id"])
            store.save()
            st.rerun()


def refresh_prices(store: Store) -> None:
    holdings = store.holdings()
    mf_isins = {h.isin for h in holdings if h.asset_class in m.MF_CLASSES and h.isin}
    stock_syms = {agg.price_key(h): h.symbol for h in holdings
                  if h.asset_class in (m.STOCK, m.ETF) and h.symbol}
    got: dict = {}
    with st.spinner("Fetching latest prices…"):
        try:
            got.update(prices.fetch_mf_navs(mf_isins))
        except Exception as exc:
            st.sidebar.warning(f"AMFI NAV fetch failed: {exc}")
        got.update(prices.fetch_stock_prices(stock_syms))
    store.set_prices(got)
    store.save()
    st.sidebar.success(f"Updated {len(got)} of {len(mf_isins) + len(stock_syms)} prices")


def empty_state() -> None:
    st.title("📈 Investment Dashboard")
    st.info("Import a statement from the sidebar (or click **Load demo data**) to get started.")
    st.markdown(HOW_TO)


HOW_TO = """
#### Where to get each statement

| Source | What to download | Covers |
|---|---|---|
| **MyCAMS** ([mycams.camsonline.com](https://mycams.camsonline.com) → Statements → CAS – CAMS+KFintech) or **KFintech** ([mfs.kfintech.com](https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement)) | *Detailed* Consolidated Account Statement PDF, period "Since inception", password = PAN | All mutual funds across every AMC and platform (incl. Groww, Kuvera, Coin…), full transaction history → XIRR |
| **Groww** (app → Profile → Reports → *Holdings / Stocks holding statement* and *Mutual funds holding statement*) | XLSX | Groww stocks & MFs with average cost |
| **Demat – CDSL** ([cdslindia.com](https://www.cdslindia.com) → CAS) or **NSDL** ([nsdlcas.nsdl.com](https://nsdlcas.nsdl.com)) — also emailed monthly | CAS PDF, password = PAN (sometimes PAN+DOB) | Every share, ETF, bond, SGB and demat MF across all your demat accounts, plus NPS |
| **Any broker** (Zerodha Console, Upstox, Angel One, ICICI Direct…) | Holdings CSV/XLSX | Stocks with cost basis |

The same fund or stock appearing in two statements (e.g. a Groww fund also in your CAS, or Groww shares also in your CDSL CAS) is shown **once** — see the *Overlaps* tab.
"""


def dashboard(store: Store) -> None:
    raw = agg.apply_prices(store.holdings(), store.prices)
    kept, dropped = agg.dedupe(raw)
    df_all = agg.to_frame(kept)

    st.title("📈 Investment Dashboard")
    investors = sorted({r["investor"] for r in store.imports if r.get("investor")})
    if investors:
        st.caption("Investor: " + ", ".join(investors))

    f1, f2 = st.columns(2)
    classes = f1.multiselect("Asset class", sorted(df_all["Asset class"].unique()), placeholder="All")
    sources = f2.multiselect("Source", sorted(df_all["Source"].unique()), placeholder="All")
    df = df_all
    if classes:
        df = df[df["Asset class"].isin(classes)]
    if sources:
        df = df[df["Source"].isin(sources)]

    t = agg.totals(df)
    rate = agg.mf_xirr(store.cashflows(), raw)
    k = st.columns(5)
    k[0].metric("Current value", inr(t["value"]), help=inr(t["value"], short=False))
    k[1].metric("Invested", inr(t["invested"]),
                help="Sum of cost for holdings whose statement reports it"
                     + (f" ({inr(t['value_without_cost'])} of value has no cost info)"
                        if t["value_without_cost"] > 1 else ""))
    k[2].metric("Unrealised gain", inr(t["gain"]),
                delta=f"{t['gain_pct']:+.2f}%" if t["gain_pct"] is not None else None)
    k[3].metric("MF XIRR", f"{rate * 100:.2f}%" if rate is not None else "—",
                help="From transaction history in a detailed CAMS/KFintech CAS")
    k[4].metric("Holdings", t["count"], help=f"{len(dropped)} duplicate entries merged")

    tabs = st.tabs(["Overview", "Mutual funds", "Stocks & ETFs", "All holdings", "Overlaps", "History"])
    with tabs[0]:
        overview(df, store)
    with tabs[1]:
        holdings_table(df[df["Asset class"].isin(m.MF_CLASSES)], group_col="AMC", key="mf")
    with tabs[2]:
        holdings_table(df[~df["Asset class"].isin(m.MF_CLASSES)], group_col="Account", key="stocks")
    with tabs[3]:
        holdings_table(df, group_col=None, key="all")
    with tabs[4]:
        overlaps(dropped)
    with tabs[5]:
        history(store)

    # Record today's net worth (unfiltered) so the History tab builds up over time
    tt = agg.totals(df_all)
    store.record_snapshot(tt["value"], tt["invested"])
    store.save()


def bar(g: pd.DataFrame, by: str, colors: dict[str, str], title: str):
    g = g.sort_values("Value")
    g["label"] = [f"{inr(v)} · {s:.1f}%" for v, s in zip(g["Value"], g["Share %"])]
    fig = px.bar(g, x="Value", y=by, orientation="h", color=by, color_discrete_map=colors, text="label",
                 custom_data=["Holdings", "Invested"], title=title)
    fig.update_traces(textposition="outside", cliponaxis=False, marker_line_width=0,
                      hovertemplate="<b>%{y}</b><br>Value ₹%{x:,.0f}<br>%{customdata[0]} holdings<extra></extra>")
    fig.update_layout(showlegend=False, height=70 + 44 * len(g), margin=dict(l=0, r=120, t=40, b=0),
                      xaxis=dict(visible=False), yaxis_title=None, bargap=0.35)
    return fig


def overview(df: pd.DataFrame, store: Store) -> None:
    if df.empty:
        st.info("No holdings match the filters.")
        return
    c1, c2 = st.columns(2)
    c1.plotly_chart(bar(agg.group(df, "Asset class"), "Asset class", CLASS_COLORS, "Allocation by asset class"),
                    use_container_width=True)
    c2.plotly_chart(bar(agg.group(df, "Source"), "Source", SOURCE_COLORS, "By source"),
                    use_container_width=True)

    top = df.nlargest(10, "Value").sort_values("Value")
    fig = px.bar(top, x="Value", y="Name", orientation="h", color="Asset class",
                 color_discrete_map=CLASS_COLORS, title="Top 10 holdings",
                 custom_data=["Source", "Gain"])
    fig.update_traces(marker_line_width=0,
                      hovertemplate="<b>%{y}</b><br>Value ₹%{x:,.0f}<br>%{customdata[0]}<extra></extra>")
    fig.update_layout(height=460, margin=dict(l=0, r=10, t=40, b=0), yaxis_title=None, xaxis_title="Value (₹)",
                      yaxis=dict(categoryorder="total ascending"),
                      legend=dict(orientation="h", y=-0.15, title=None), bargap=0.35)
    st.plotly_chart(fig, use_container_width=True)

    stale = df[df["Price source"] == "statement"]
    if len(stale):
        oldest = stale["As of"].min()
        st.caption(f"{len(stale)} holdings are valued at statement prices (oldest: {oldest}). "
                   "Use **Refresh live prices** in the sidebar for today's values.")


def holdings_table(df: pd.DataFrame, group_col: str | None, key: str) -> None:
    if df.empty:
        st.info("No holdings here.")
        return
    if group_col and df[group_col].notna().any():
        g = agg.group(df, group_col)
        g["Gain"] = g["Value"] - g["Invested"]
        st.dataframe(g, hide_index=True, use_container_width=True, column_config={
            "Value": st.column_config.NumberColumn(format="₹%.0f"),
            "Invested": st.column_config.NumberColumn(format="₹%.0f"),
            "Gain": st.column_config.NumberColumn(format="₹%.0f"),
            "Share %": st.column_config.ProgressColumn(format="%.1f%%", min_value=0, max_value=100),
        })
    show = df.sort_values("Value", ascending=False)
    st.dataframe(show, hide_index=True, use_container_width=True, height=min(700, 40 + 35 * len(show)),
                 column_config={
                     "Units": st.column_config.NumberColumn(format="%.3f"),
                     "Price": st.column_config.NumberColumn(format="₹%.2f"),
                     "Invested": st.column_config.NumberColumn(format="₹%.0f"),
                     "Value": st.column_config.NumberColumn(format="₹%.0f"),
                     "Gain": st.column_config.NumberColumn(format="₹%.0f"),
                     "Return %": st.column_config.NumberColumn(format="%.2f%%"),
                 })
    st.download_button("Download CSV", show.to_csv(index=False).encode(), f"holdings-{key}.csv", "text/csv", key=f"dl-{key}")


def overlaps(dropped: list[tuple[m.Holding, m.Holding]]) -> None:
    st.caption("Holdings that appeared in more than one statement. Each is counted once, using the record "
               "shown under *Kept* (the one with cost basis / from the most authoritative source).")
    if not dropped:
        st.info("No overlaps found.")
        return
    rows = [{"Name": d.name, "Units": d.units, "Duplicate from": f"{d.source} · {d.account}",
             "Kept": f"{k.source} · {k.account}", "Value": k.value} for d, k in dropped]
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True,
                 column_config={"Value": st.column_config.NumberColumn(format="₹%.0f")})


def history(store: Store) -> None:
    hist = pd.DataFrame(store.data["history"])
    if len(hist) < 2:
        st.info("Net worth is recorded each day you open the dashboard. Come back after a few days to see the trend.")
        if len(hist):
            st.dataframe(hist, hide_index=True)
        return
    hist["date"] = pd.to_datetime(hist["date"])
    long = hist.melt("date", ["value", "invested"], var_name="Series", value_name="₹")
    long["Series"] = long["Series"].map({"value": "Current value", "invested": "Invested"})
    fig = px.line(long, x="date", y="₹", color="Series", markers=True, title="Net worth over time",
                  color_discrete_map={"Current value": "#2a78d6", "Invested": "#eb6834"})
    fig.update_traces(line_width=2, marker_size=8)
    fig.update_layout(hovermode="x unified", xaxis_title=None, legend=dict(orientation="h", y=1.1, title=None))
    st.plotly_chart(fig, use_container_width=True)


def main() -> None:
    store = Store()
    sidebar(store)
    if not store.imports:
        empty_state()
    else:
        dashboard(store)
        with st.expander("Where do I get these statements?"):
            st.markdown(HOW_TO)


main()

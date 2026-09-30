"""Local JSON store for imported statements, refreshed prices, and net-worth history.

Everything stays on your machine in data/portfolio.json (git-ignored)."""
from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from .models import CashFlow, Holding, ImportResult

DATA_DIR = Path(os.environ.get("PORTFOLIO_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))


class Store:
    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else DATA_DIR / "portfolio.json"
        self.data = {"imports": [], "prices": {}, "history": []}
        if self.path.exists():
            self.data.update(json.loads(self.path.read_text()))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=1, default=str))
        tmp.replace(self.path)

    # --- imports -------------------------------------------------------
    @property
    def imports(self) -> list[dict]:
        return self.data["imports"]

    def add_import(self, result: ImportResult, filename: str) -> dict:
        """Store a parsed statement. A newer statement of the same kind for the same investor
        replaces the older one, since each statement is a full snapshot of those holdings."""
        key = _replace_key(result)
        self.data["imports"] = [i for i in self.imports if i.get("key") != key]
        rec = {
            "id": uuid.uuid4().hex[:10],
            "key": key,
            "kind": result.kind,
            "filename": filename,
            "investor": result.investor,
            "statement_date": result.statement_date,
            "imported_at": datetime.now().isoformat(timespec="seconds"),
            "warnings": result.warnings,
            "holdings": [h.to_dict() for h in result.holdings],
            "cashflows": [c.to_dict() for c in result.cashflows],
        }
        self.imports.append(rec)
        return rec

    def remove_import(self, import_id: str) -> None:
        self.data["imports"] = [i for i in self.imports if i["id"] != import_id]

    def holdings(self) -> list[Holding]:
        out = []
        for rec in self.imports:
            for d in rec["holdings"]:
                h = Holding.from_dict(d)
                h.import_id = rec["id"]
                out.append(h)
        return out

    def cashflows(self) -> list[tuple[str, CashFlow]]:
        return [(rec["id"], CashFlow(**c)) for rec in self.imports for c in rec.get("cashflows", [])]

    # --- prices --------------------------------------------------------
    @property
    def prices(self) -> dict:
        return self.data["prices"]

    def set_prices(self, prices: dict[str, dict]) -> None:
        self.data["prices"].update(prices)

    # --- history -------------------------------------------------------
    def record_snapshot(self, value: float, invested: float, on: Optional[date] = None) -> None:
        day = (on or date.today()).isoformat()
        hist = [h for h in self.data["history"] if h["date"] != day]
        hist.append({"date": day, "value": round(value, 2), "invested": round(invested, 2)})
        self.data["history"] = sorted(hist, key=lambda h: h["date"])


def _replace_key(result: ImportResult) -> str:
    kind = result.kind.split(" (")[0]  # "CAMS CAS (DETAILED)" and "(SUMMARY)" supersede each other
    accounts = ""
    if kind.endswith("CAS") and ("CDSL" in kind or "NSDL" in kind):
        accounts = ",".join(sorted({h.account for h in result.holdings}))
    return f"{kind}|{(result.investor or '').upper()}|{accounts}"

"""Statement importers. `parse_file` detects the statement type and returns an ImportResult."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional

from ..models import ImportResult
from .cas import parse_cas_pdf
from .tabular import parse_tabular


class ImportError_(Exception):
    pass


def parse_file(path: str | Path, passwords: Iterable[str] = (), filename: Optional[str] = None) -> ImportResult:
    path = Path(path)
    suffix = Path(filename or path.name).suffix.lower()
    if suffix == ".pdf":
        candidates = [p.strip() for p in passwords if p and p.strip()] or [""]
        last_error: Exception | None = None
        for pw in candidates:
            try:
                return parse_cas_pdf(path, pw)
            except Exception as exc:  # wrong password or unsupported layout
                last_error = exc
        raise ImportError_(f"Could not read {filename or path.name}: {last_error}")
    if suffix in (".xlsx", ".xls", ".csv"):
        return parse_tabular(path, filename=filename)
    raise ImportError_(f"Unsupported file type: {suffix}")

"""A user's company list — CSV, Excel or PDF — as ``(row, name, link)`` rows.

Every row needs a careers link; the name is optional (the link supplies one).
The file is untrusted input:

- Excel files are zip archives, so the archive's total uncompressed size is
  checked before openpyxl sees it (a small upload cannot inflate to gigabytes),
  and ``defusedxml`` is installed so openpyxl parses its XML defensively.
- PDFs go through the existing sandboxed poppler helpers (``app.pdftext``),
  never an in-process parser.
- At most ``MAX_ROWS`` rows and ``MAX_COLUMNS`` columns are read.

Link validation (http(s), no aggregators) happens in the route with
``sources.normalize_link``, so all three formats share one rule.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .sources import links_in_text, looks_like_link


MAX_ROWS = 1_000
MAX_COLUMNS = 20
MAX_CELL_CHARACTERS = 500
MAX_XLSX_UNCOMPRESSED_BYTES = 50_000_000
MAX_COMPANY_PDF_PAGES = 10

_NAME_HEADERS = ("company", "company name", "name", "organisation", "organization", "employer", "companies")
_LINK_HEADERS = (
    "careers", "career", "career page", "careers page", "careers url", "career url",
    "careers link", "career link", "jobs", "jobs page", "job link", "jobs link",
    "job board", "link", "url", "careers site",
)
_WEBSITE_HEADERS = ("website", "site", "domain", "homepage", "web")
_BULLET = re.compile(r"^\s*(?:[-*•·▪◦‣–—]|\(?\d{1,4}[.)\]]|\[\d{1,4}\])\s*")
_TRAILING_SEPARATORS = re.compile(r"[\s:|,;–—\-]+$")
_GENERIC_LABELS = frozenset(
    ("careers", "career", "jobs", "job", "link", "here", "apply", "open", "website", "url", "click here", "view")
)


class CompanyListError(ValueError):
    """The file could not be read as a company list; the message is safe to show."""


@dataclass
class ParsedRow:
    row: int
    name: str
    link: str


@dataclass
class ParsedList:
    rows: List[ParsedRow] = field(default_factory=list)
    skipped: List[Tuple[int, str]] = field(default_factory=list)


def detect_format(filename: str, data: bytes) -> str:
    """``csv``, ``xlsx`` or ``pdf`` — by content first, extension second."""

    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:4] == b"PK\x03\x04":
        return "xlsx"
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise CompanyListError("Old .xls files are not supported. Save the sheet as .xlsx or CSV.")
    lowered = (filename or "").lower()
    if lowered.endswith((".xlsx", ".xlsm")):
        raise CompanyListError("That Excel file could not be read.")
    if lowered.endswith(".pdf"):
        raise CompanyListError("That PDF could not be read.")
    return "csv"


# ---------------------------------------------------------------------------
# Tabular formats (CSV and Excel share the column logic)
# ---------------------------------------------------------------------------


@dataclass
class _Cell:
    text: str
    hyperlink: str = ""


def parse_csv(data: bytes) -> ParsedList:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
    if "\x00" in text:
        raise CompanyListError("That file is not a CSV text file.")
    sample = text[:20_000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    grid: List[List[_Cell]] = []
    try:
        for index, row in enumerate(csv.reader(io.StringIO(text), dialect)):
            if index >= MAX_ROWS + 1:
                break
            grid.append([_Cell(_cell_text(value)) for value in row[:MAX_COLUMNS]])
    except csv.Error as exc:
        raise CompanyListError("That CSV could not be read.") from exc
    return _parse_grid(grid)


def parse_xlsx(data: bytes) -> ParsedList:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        uncompressed = sum(info.file_size for info in archive.infolist())
    except (zipfile.BadZipFile, OSError) as exc:
        raise CompanyListError("That Excel file could not be read.") from exc
    if uncompressed > MAX_XLSX_UNCOMPRESSED_BYTES:
        raise CompanyListError("That Excel file is too large once unpacked.")
    try:
        from openpyxl import load_workbook

        # Not read_only: read-only worksheets drop cell hyperlinks, and a
        # "Careers" cell that links to the page is a common way to write a list.
        workbook = load_workbook(io.BytesIO(data), read_only=False, data_only=True)
    except Exception as exc:  # openpyxl raises many types for malformed files
        raise CompanyListError("That Excel file could not be read.") from exc
    try:
        sheet = workbook.worksheets[0] if workbook.worksheets else None
        if sheet is None:
            return ParsedList()
        grid: List[List[_Cell]] = []
        for row in sheet.iter_rows(max_row=MAX_ROWS + 1, max_col=MAX_COLUMNS):
            cells: List[_Cell] = []
            for cell in row:
                value = cell.value
                text = "" if value is None else _cell_text(str(value))
                link = ""
                hyperlink = getattr(cell, "hyperlink", None)
                if hyperlink is not None and getattr(hyperlink, "target", None):
                    link = _cell_text(str(hyperlink.target))
                cells.append(_Cell(text, link))
            grid.append(cells)
    finally:
        workbook.close()
    return _parse_grid(grid)


def _cell_text(value: str) -> str:
    return " ".join(value.replace("\x00", "").split())[:MAX_CELL_CHARACTERS]


def _header_index(header: Sequence[_Cell], names: Sequence[str]) -> Optional[int]:
    for index, cell in enumerate(header):
        if cell.text.strip().lower().rstrip(":") in names:
            return index
    return None


def _parse_grid(grid: List[List[_Cell]]) -> ParsedList:
    result = ParsedList()
    rows = [row for row in grid]
    if not rows:
        return result

    header = rows[0]
    name_col = _header_index(header, _NAME_HEADERS)
    link_col = _header_index(header, _LINK_HEADERS)
    website_col = _header_index(header, _WEBSITE_HEADERS)
    has_header = name_col is not None or link_col is not None or website_col is not None
    if link_col is None:
        link_col = website_col
    body = rows[1:] if has_header else rows
    offset = 2 if has_header else 1

    for index, cells in enumerate(body[:MAX_ROWS]):
        row_number = index + offset
        if not any(cell.text or cell.hyperlink for cell in cells):
            continue
        name, link = "", ""
        if has_header:
            if name_col is not None and name_col < len(cells):
                name = cells[name_col].text
            if link_col is not None and link_col < len(cells):
                cell = cells[link_col]
                link = cell.hyperlink or (cell.text if looks_like_link(cell.text) else "")
            if not link:
                link = _first_link(cells)
        else:
            link = _first_link(cells)
            for cell in cells:
                if cell.text and not looks_like_link(cell.text):
                    name = cell.text
                    break
        if name and looks_like_link(name):
            name = ""
        if not link:
            result.skipped.append((row_number, "missing link"))
            continue
        result.rows.append(ParsedRow(row=row_number, name=name[:120], link=link))
    return result


def _first_link(cells: Sequence[_Cell]) -> str:
    for cell in cells:
        if cell.hyperlink:
            return cell.hyperlink
        if looks_like_link(cell.text):
            return cell.text
    return ""


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


def parse_pdf(text: str, annotation_links: List[Dict[str, str]]) -> ParsedList:
    """Lines with a written-out URL, plus links attached to words.

    On a line, the text before the URL is the name (bullets and numbering
    stripped). A link attached to a word ("Careers") carries no line position,
    so its label becomes the name unless it is a generic word.
    """

    result = ParsedList()
    seen_links = set()
    lines = (text or "").splitlines()
    for index, line in enumerate(lines[: MAX_ROWS * 3]):
        urls = links_in_text(line)
        if not urls:
            bare = [token for token in line.split() if token.lower().startswith("www.")]
            urls = bare[:1]
        if not urls:
            continue
        link = urls[0]
        before = line.split(link, 1)[0]
        name = _TRAILING_SEPARATORS.sub("", _BULLET.sub("", before)).strip()
        if looks_like_link(name):
            name = ""
        seen_links.add(link.rstrip("/").lower())
        result.rows.append(ParsedRow(row=index + 1, name=name[:120], link=link))
        if len(result.rows) >= MAX_ROWS:
            return result

    for item in annotation_links:
        link = (item.get("url") or "").strip()
        if not link or link.rstrip("/").lower() in seen_links:
            continue
        seen_links.add(link.rstrip("/").lower())
        label = " ".join((item.get("label") or "").split())
        name = "" if label.lower() in _GENERIC_LABELS or looks_like_link(label) else label
        result.rows.append(ParsedRow(row=0, name=name[:120], link=link))
        if len(result.rows) >= MAX_ROWS:
            break
    return result


def parse_file(
    filename: str,
    data: bytes,
    pdf_reader: Any = None,
) -> ParsedList:
    """Dispatch on the detected format. ``pdf_reader(bytes) -> (text, links)``."""

    kind = detect_format(filename, data)
    if kind == "xlsx":
        return parse_xlsx(data)
    if kind == "pdf":
        if pdf_reader is None:
            raise CompanyListError("PDF lists are not supported on this server.")
        text, links = pdf_reader(data)
        return parse_pdf(text, links)
    return parse_csv(data)

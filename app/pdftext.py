"""Bounded plain-text extraction from uploaded PDF resumes via poppler pdftotext.

Security rationale:
- The PDF bytes are untrusted user input. They are never parsed in-process;
  extraction is delegated to the ``pdftotext`` binary running against a file in
  a throwaway temporary directory, invoked with an argument list (never
  ``shell=True``) and a hard timeout.
- Magic-byte and size checks happen before anything touches disk, so callers
  can rely on structured error codes instead of arbitrary subprocess noise.
- The extracted text is sanitized (NULs stripped, runaway blank lines
  collapsed) and capped, because it will be embedded into an LLM prompt and
  stored per-user; unbounded output would be a memory and token-cost hazard.
- Hyperlink targets live in the PDF's link annotations, not in its text, so
  ``pdftotext`` and a page image both show only the anchor word ("LinkedIn").
  ``pdftohtml -xml`` is used to recover the label/URL pairs, which are then
  given to the model as a third, separate input.
- Page count is checked with ``pdfinfo`` before any text is extracted. A resume
  is a short document, so a large page count means either a mistaken upload or
  someone using the importer to feed a book into a paid LLM. The check fails
  open when ``pdfinfo`` is unavailable: the character cap below is still a hard
  backstop, and ``/api/health`` reports the missing binary.

All functions here are synchronous by design; async callers wrap them in
``run_in_executor`` so the event loop is never blocked by subprocess I/O.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional


PDF_MAGIC = b"%PDF-"
MAX_EXTRACTED_CHARACTERS = 150_000
MIN_MEANINGFUL_CHARACTERS = 150
DEFAULT_MAX_PAGES = 3
#: Enough resolution for a vision model to read 9pt resume body text without
#: pushing image payloads (and their per-request token cost) up needlessly.
DEFAULT_RENDER_DPI = 150
MAX_RENDERED_BYTES = 12_000_000

_PAGES_PATTERN = re.compile(r"^Pages:\s*(\d+)\s*$", re.MULTILINE)

_BLANK_RUN_PATTERN = re.compile(r"\n{3,}")


class PdfExtractionError(RuntimeError):
    """Extraction failure carrying a stable machine-readable ``code``.

    Codes: ``invalid_pdf``, ``pdf_too_large``, ``pdf_too_many_pages``,
    ``pdftotext_missing``, ``pdf_extract_failed``, ``pdf_extract_timeout``,
    ``pdf_no_text``, ``pdftoppm_missing``, ``pdf_render_failed``,
    ``pdf_render_timeout``.
    """

    def __init__(self, message: str, code: str) -> None:
        self.code = code
        super().__init__(message)


def is_pdftotext_available(bin_path: str) -> bool:
    """Report whether the configured pdftotext binary is resolvable."""

    try:
        return shutil.which(bin_path) is not None
    except (TypeError, ValueError):
        return False


def is_pdfinfo_available(bin_path: str) -> bool:
    """Report whether the configured pdfinfo binary is resolvable."""

    try:
        return shutil.which(bin_path) is not None
    except (TypeError, ValueError):
        return False


def is_pdftoppm_available(bin_path: str) -> bool:
    """Report whether the configured pdftoppm binary is resolvable."""

    try:
        return shutil.which(bin_path) is not None
    except (TypeError, ValueError):
        return False


_ANCHOR_PATTERN = re.compile(
    r"<a\s+href=\"([^\"]{1,2000})\"[^>]*>(.*?)</a>", re.IGNORECASE | re.DOTALL
)
_TAG_PATTERN = re.compile(r"<[^>]+>")


def _unescape(value: str) -> str:
    for entity, char in (
        ("&#160;", " "), ("&nbsp;", " "), ("&amp;", "&"),
        ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'"),
    ):
        value = value.replace(entity, char)
    return value


def extract_pdf_links(
    pdf_bytes: bytes,
    bin_path: str = "pdftohtml",
    timeout_seconds: int = 30,
    max_bytes: int = 10_000_000,
    max_links: int = 40,
) -> List[Dict[str, str]]:
    """Recover ``[{"label", "url"}]`` from the PDF's link annotations.

    A resume's contact row is typically a set of words ("Portfolio", "GitHub")
    hyperlinked to profile URLs. Neither the text layer nor a page image carries
    the target, so without this the model can only ever return the label. Best
    effort by design: any failure yields an empty list and the import proceeds.
    """

    if not isinstance(pdf_bytes, (bytes, bytearray)) or bytes(pdf_bytes[:5]) != PDF_MAGIC:
        return []
    if len(pdf_bytes) > max_bytes:
        return []

    with tempfile.TemporaryDirectory(prefix="pdflinks-") as workdir:
        input_path = Path(workdir) / "in.pdf"
        try:
            input_path.write_bytes(bytes(pdf_bytes))
            completed = subprocess.run(
                [bin_path, "-xml", "-i", "-stdout", str(input_path)],
                capture_output=True,
                text=True,
                errors="replace",
                check=False,
                timeout=timeout_seconds,
            )
        except (OSError, subprocess.SubprocessError):
            return []
        if completed.returncode != 0:
            return []
        markup = completed.stdout

    links: List[Dict[str, str]] = []
    seen = set()
    for url, label in _ANCHOR_PATTERN.findall(markup):
        url = _unescape(url).strip()
        # Rendering rejects anything that is not http(s) anyway.
        if not url.lower().startswith(("http://", "https://")):
            continue
        label = _unescape(_TAG_PATTERN.sub("", label)).strip()
        key = (label.casefold(), url)
        if key in seen:
            continue
        seen.add(key)
        links.append({"label": label[:100], "url": url[:500]})
        if len(links) >= max_links:
            break
    return links


def is_pdftohtml_available(bin_path: str) -> bool:
    """Report whether the configured pdftohtml binary is resolvable."""

    try:
        return shutil.which(bin_path) is not None
    except (TypeError, ValueError):
        return False


def _page_count(pdf_path: Path, bin_path: str, timeout_seconds: int) -> Optional[int]:
    """Return the PDF page count, or ``None`` when it cannot be determined.

    Callers treat ``None`` as "unknown, proceed": a missing or unhappy pdfinfo
    must not block imports on a server that can still extract text.
    """

    try:
        completed = subprocess.run(
            [bin_path, str(pdf_path)],
            capture_output=True,
            text=True,
            errors="replace",
            check=False,
            timeout=timeout_seconds,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    match = _PAGES_PATTERN.search(completed.stdout)
    return int(match.group(1)) if match else None


def _clean_text(raw: str) -> str:
    text = raw.replace("\x00", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _BLANK_RUN_PATTERN.sub("\n\n", text)
    return text.strip()[:MAX_EXTRACTED_CHARACTERS]


def extract_pdf_text(
    pdf_bytes: bytes,
    bin_path: str = "pdftotext",
    timeout_seconds: int = 30,
    max_bytes: int = 10_000_000,
    max_pages: int = DEFAULT_MAX_PAGES,
    pdfinfo_bin: str = "pdfinfo",
) -> str:
    """Extract bounded plain text from an uploaded PDF (sync; run in executor)."""

    if not isinstance(pdf_bytes, (bytes, bytearray)) or bytes(pdf_bytes[:5]) != PDF_MAGIC:
        raise PdfExtractionError("The uploaded file is not a PDF document", "invalid_pdf")
    if len(pdf_bytes) > max_bytes:
        raise PdfExtractionError(
            "The uploaded PDF exceeds the {0} byte safety limit".format(max_bytes),
            "pdf_too_large",
        )

    with tempfile.TemporaryDirectory(prefix="pdftext-") as workdir:
        input_path = Path(workdir) / "in.pdf"
        output_path = Path(workdir) / "out.txt"
        input_path.write_bytes(bytes(pdf_bytes))

        pages = _page_count(input_path, pdfinfo_bin, timeout_seconds)
        if pages is not None and max_pages > 0 and pages > max_pages:
            raise PdfExtractionError(
                "This PDF has {0} pages; resumes are limited to {1}".format(
                    pages, max_pages
                ),
                "pdf_too_many_pages",
            )

        command = [
            bin_path,
            "-layout",
            "-enc",
            "UTF-8",
            str(input_path),
            str(output_path),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                check=False,
                timeout=timeout_seconds,
            )
        except FileNotFoundError as exc:
            raise PdfExtractionError(
                "The pdftotext executable is not installed on this server",
                "pdftotext_missing",
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise PdfExtractionError(
                "PDF text extraction timed out after {0} seconds".format(timeout_seconds),
                "pdf_extract_timeout",
            ) from exc
        except OSError as exc:
            raise PdfExtractionError(
                "PDF text extraction could not be started", "pdf_extract_failed"
            ) from exc

        if completed.returncode != 0 or not output_path.is_file():
            raise PdfExtractionError(
                "pdftotext could not read this PDF", "pdf_extract_failed"
            )
        try:
            raw = output_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise PdfExtractionError(
                "The extracted text could not be read", "pdf_extract_failed"
            ) from exc

    text = _clean_text(raw)
    meaningful = len("".join(text.split()))
    if meaningful < MIN_MEANINGFUL_CHARACTERS:
        raise PdfExtractionError(
            "The PDF contains almost no extractable text; it looks like a "
            "scanned/image PDF",
            "pdf_no_text",
        )
    return text


def render_pdf_pages(
    pdf_bytes: bytes,
    bin_path: str = "pdftoppm",
    timeout_seconds: int = 60,
    max_bytes: int = 10_000_000,
    max_pages: int = DEFAULT_MAX_PAGES,
    dpi: int = DEFAULT_RENDER_DPI,
) -> List[bytes]:
    """Rasterize the first ``max_pages`` pages to PNG bytes (sync; run in executor).

    This is the scanned-resume path: when :func:`extract_pdf_text` finds no text
    layer there is nothing for a text model to read, so the pages are rendered
    and sent to a vision model instead. The same untrusted-input rules apply --
    poppler runs out-of-process against a throwaway directory with an argument
    list and a hard timeout, and the output is size-capped before it is held in
    memory or turned into an LLM payload.
    """

    if not isinstance(pdf_bytes, (bytes, bytearray)) or bytes(pdf_bytes[:5]) != PDF_MAGIC:
        raise PdfExtractionError("The uploaded file is not a PDF document", "invalid_pdf")
    if len(pdf_bytes) > max_bytes:
        raise PdfExtractionError(
            "The uploaded PDF exceeds the {0} byte safety limit".format(max_bytes),
            "pdf_too_large",
        )

    with tempfile.TemporaryDirectory(prefix="pdfrender-") as workdir:
        input_path = Path(workdir) / "in.pdf"
        input_path.write_bytes(bytes(pdf_bytes))
        prefix = Path(workdir) / "page"
        command = [
            bin_path,
            "-png",
            "-r",
            str(dpi),
            "-f",
            "1",
            "-l",
            str(max(1, max_pages)),
            str(input_path),
            str(prefix),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                check=False,
                timeout=timeout_seconds,
            )
        except FileNotFoundError as exc:
            raise PdfExtractionError(
                "The pdftoppm executable is not installed on this server",
                "pdftoppm_missing",
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise PdfExtractionError(
                "Rendering the PDF timed out after {0} seconds".format(timeout_seconds),
                "pdf_render_timeout",
            ) from exc
        except OSError as exc:
            raise PdfExtractionError(
                "PDF rendering could not be started", "pdf_render_failed"
            ) from exc

        if completed.returncode != 0:
            raise PdfExtractionError(
                "pdftoppm could not render this PDF", "pdf_render_failed"
            )

        pages: List[bytes] = []
        total = 0
        # pdftoppm numbers its output, so sorting by name restores page order
        # for the single-digit counts this cap allows.
        for path in sorted(Path(workdir).glob("page*.png")):
            try:
                data = path.read_bytes()
            except OSError as exc:
                raise PdfExtractionError(
                    "A rendered page could not be read", "pdf_render_failed"
                ) from exc
            total += len(data)
            if total > MAX_RENDERED_BYTES:
                raise PdfExtractionError(
                    "The rendered pages exceed the {0} byte safety limit".format(
                        MAX_RENDERED_BYTES
                    ),
                    "pdf_render_failed",
                )
            pages.append(data)

    if not pages:
        raise PdfExtractionError(
            "pdftoppm produced no page images", "pdf_render_failed"
        )
    return pages

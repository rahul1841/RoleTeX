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

All functions here are synchronous by design; async callers wrap them in
``run_in_executor`` so the event loop is never blocked by subprocess I/O.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path


PDF_MAGIC = b"%PDF-"
MAX_EXTRACTED_CHARACTERS = 150_000
MIN_MEANINGFUL_CHARACTERS = 150

_BLANK_RUN_PATTERN = re.compile(r"\n{3,}")


class PdfExtractionError(RuntimeError):
    """Extraction failure carrying a stable machine-readable ``code``.

    Codes: ``invalid_pdf``, ``pdf_too_large``, ``pdftotext_missing``,
    ``pdf_extract_failed``, ``pdf_extract_timeout``, ``pdf_no_text``.
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

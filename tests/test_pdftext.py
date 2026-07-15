"""Unit tests for bounded pdftotext extraction (subprocess is faked)."""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Callable, Optional

import pytest

from app import pdftext
from app.pdftext import (
    MAX_EXTRACTED_CHARACTERS,
    PdfExtractionError,
    extract_pdf_text,
    is_pdftotext_available,
)


PDF_BYTES = b"%PDF-1.7 pretend document body"

MEANINGFUL_TEXT = (
    "Jane Doe jane@example.com Berlin.\n"
    "Senior Engineer at Acme (2021 - Present) building reliable Python services.\n"
    "Skills: Python, SQL, Docker, Kubernetes, FastAPI, PostgreSQL and more text "
    "so the meaningful-character floor is comfortably cleared."
)


def _fake_run(
    monkeypatch: pytest.MonkeyPatch,
    text: Optional[str] = MEANINGFUL_TEXT,
    returncode: int = 0,
    raises: Optional[BaseException] = None,
) -> Callable:
    """Replace subprocess.run inside app.pdftext with a controllable fake."""

    calls = []

    def fake(command, capture_output, check, timeout):
        calls.append({"command": list(command), "check": check, "timeout": timeout})
        if raises is not None:
            raise raises
        if text is not None:
            Path(command[-1]).write_text(text, encoding="utf-8")
        return SimpleNamespace(returncode=returncode, stdout=b"", stderr=b"")

    monkeypatch.setattr(pdftext.subprocess, "run", fake)
    return calls


# --- real (unmocked) input validation ---------------------------------------


def test_rejects_non_pdf_magic_bytes_without_touching_subprocess() -> None:
    with pytest.raises(PdfExtractionError) as excinfo:
        extract_pdf_text(b"MZ definitely not a pdf", bin_path="pdftotext")
    assert excinfo.value.code == "invalid_pdf"

    with pytest.raises(PdfExtractionError) as excinfo:
        extract_pdf_text(b"", bin_path="pdftotext")
    assert excinfo.value.code == "invalid_pdf"


def test_rejects_pdf_over_the_configured_size_cap() -> None:
    oversized = b"%PDF-" + b"x" * 100
    with pytest.raises(PdfExtractionError) as excinfo:
        extract_pdf_text(oversized, bin_path="pdftotext", max_bytes=50)
    assert excinfo.value.code == "pdf_too_large"


# --- subprocess behavior (faked) ---------------------------------------------


def test_successful_extraction_invokes_pdftotext_safely(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _fake_run(monkeypatch)

    text = extract_pdf_text(PDF_BYTES, bin_path="my-pdftotext", timeout_seconds=17)

    assert "Senior Engineer at Acme" in text
    assert len(calls) == 1
    command = calls[0]["command"]
    assert command[0] == "my-pdftotext"
    assert command[1:4] == ["-layout", "-enc", "UTF-8"]
    assert command[4].endswith("in.pdf")
    assert command[5].endswith("out.txt")
    assert calls[0]["check"] is False
    assert calls[0]["timeout"] == 17


def test_output_is_sanitized_collapsed_and_capped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    noisy = (
        MEANINGFUL_TEXT
        + "\x00\x00"
        + "\n\n\n\n\n"
        + "second block\r\nwith windows endings"
        + ("padding " * 40_000)
    )
    _fake_run(monkeypatch, text=noisy)

    text = extract_pdf_text(PDF_BYTES)

    assert "\x00" not in text
    assert "\n\n\n" not in text
    assert "\r" not in text
    assert "second block\nwith windows endings" in text
    assert len(text) <= MAX_EXTRACTED_CHARACTERS


def test_scanned_pdf_with_no_meaningful_text_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _fake_run(monkeypatch, text="   \n\n a b c \n ")

    with pytest.raises(PdfExtractionError) as excinfo:
        extract_pdf_text(PDF_BYTES)
    assert excinfo.value.code == "pdf_no_text"
    assert "scanned" in str(excinfo.value)


def test_nonzero_exit_code_maps_to_extract_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _fake_run(monkeypatch, text=None, returncode=1)

    with pytest.raises(PdfExtractionError) as excinfo:
        extract_pdf_text(PDF_BYTES)
    assert excinfo.value.code == "pdf_extract_failed"


def test_missing_binary_maps_to_pdftotext_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _fake_run(monkeypatch, raises=FileNotFoundError("no such file"))

    with pytest.raises(PdfExtractionError) as excinfo:
        extract_pdf_text(PDF_BYTES)
    assert excinfo.value.code == "pdftotext_missing"


def test_timeout_maps_to_pdf_extract_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_run(monkeypatch, raises=subprocess.TimeoutExpired(cmd="pdftotext", timeout=30))

    with pytest.raises(PdfExtractionError) as excinfo:
        extract_pdf_text(PDF_BYTES, timeout_seconds=30)
    assert excinfo.value.code == "pdf_extract_timeout"


# --- availability probe -------------------------------------------------------


def test_is_pdftotext_available_reflects_path_resolution() -> None:
    assert is_pdftotext_available("definitely-not-a-real-binary-xyz") is False
    # `sh` exists on every POSIX system the suite runs on.
    assert is_pdftotext_available("sh") is True

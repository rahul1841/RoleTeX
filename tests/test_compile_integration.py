"""End-to-end real-compile test (G-2).

The rest of the suite mocks ``subprocess.run`` so it stays fast and offline.
This module is the one place that renders the seed resume and runs it through a
*real* Tectonic process, proving the actual PDF pipeline works. It is skipped
when Tectonic is not installed, so ``pytest -q`` on a machine without the
toolchain still passes; the Docker image always has Tectonic (and poppler) and
therefore always exercises this test.

Run just this test with a warm/cold cache:

    pytest -m integration

Skip it explicitly with:

    pytest -m "not integration"
"""

from __future__ import annotations

import shutil

import pytest

from app.compiler import CompileService
from app.resume import render_template_text


requires_tectonic = pytest.mark.skipif(
    shutil.which("tectonic") is None,
    reason="Tectonic binary not on PATH; real-compile integration test skipped.",
)


@pytest.mark.integration
@requires_tectonic
@pytest.mark.asyncio
async def test_seed_resume_compiles_to_valid_single_page_pdf(
    repository, resume, template, baseline_proposal
) -> None:
    """The seed resume renders and compiles into a valid one-page PDF."""

    latex_source = render_template_text(template, resume, baseline_proposal)
    assert "@@" not in latex_source  # every template token was substituted

    # only_cached=False lets a cold Tectonic cache fetch support files once; a
    # warm cache (and the pre-warmed Docker image) never touches the network.
    service = CompileService(only_cached=False, max_pages=1, timeout_seconds=180)
    result = await service.compile(latex_source, repository.assets_dir)

    assert result.success, result.log[-4000:]
    assert result.error_code is None
    assert result.pdf_bytes is not None
    assert result.pdf_bytes[:5] == b"%PDF-"

    # Page count and ATS-readable text depend on poppler; assert them only when
    # its binaries are present so the compile check itself is not coupled to it.
    if shutil.which("pdfinfo"):
        assert result.page_count == 1
    if shutil.which("pdftotext"):
        first_name = resume.identity.name.split()[0]
        assert first_name in result.extracted_text

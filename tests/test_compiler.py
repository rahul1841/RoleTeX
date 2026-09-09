"""Tests for bounded, untrusted, unique-directory Tectonic execution."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Dict, List

import pytest

import app.compiler as compiler_module
from app.compiler import CompileService, _sanitize_log


def test_command_preview_enables_untrusted_and_cached_only_modes() -> None:
    service = CompileService(tectonic_bin="tectonic-test", only_cached=True)

    command = service.command_preview()

    assert command[:4] == ["tectonic-test", "-X", "compile", "--untrusted"]
    assert "--only-cached" in command
    assert command[-3:] == ["--outdir", "<job_dir>", "<job_dir>/resume.tex"]


def test_command_preview_can_disable_only_cached_for_image_prewarming() -> None:
    command = CompileService(only_cached=False).command_preview()

    assert "--untrusted" in command
    assert "--only-cached" not in command


@pytest.mark.asyncio
async def test_compile_uses_no_shell_untrusted_environment_and_unique_temp_dirs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = CompileService(
        tectonic_bin="tectonic-test",
        timeout_seconds=17,
        only_cached=True,
        max_pages=1,
    )
    monkeypatch.setattr(service, "is_available", lambda: True)
    monkeypatch.setattr(compiler_module, "_read_page_count", lambda path: (1, None))
    monkeypatch.setattr(
        compiler_module, "_extract_pdf_text", lambda path: ("Rahul Kumar resume", None)
    )
    calls: List[Dict[str, Any]] = []

    def fake_run(command, **kwargs):
        job_dir = Path(kwargs["cwd"])
        calls.append(
            {
                "command": list(command),
                "kwargs": kwargs,
                "job_dir": job_dir,
                "source": (job_dir / "resume.tex").read_text(encoding="utf-8"),
            }
        )
        (job_dir / "resume.pdf").write_bytes(b"%PDF-1.4\n% fake but signed\n%%EOF\n")
        return subprocess.CompletedProcess(
            command, 0, stdout="compiled in {0}".format(job_dir), stderr=""
        )

    monkeypatch.setattr(compiler_module.subprocess, "run", fake_run)

    first = await service.compile("\\documentclass{article} first")
    second = await service.compile("\\documentclass{article} second")

    assert first.success is True
    assert first.pdf_bytes is not None and first.pdf_bytes.startswith(b"%PDF-")
    assert first.page_count == 1
    assert first.extracted_text == "Rahul Kumar resume"
    assert second.success is True
    assert len(calls) == 2
    assert calls[0]["job_dir"] != calls[1]["job_dir"]
    assert calls[0]["source"].endswith("first")
    assert calls[1]["source"].endswith("second")

    for call in calls:
        command = call["command"]
        kwargs = call["kwargs"]
        job_dir = call["job_dir"]
        assert command[:4] == ["tectonic-test", "-X", "compile", "--untrusted"]
        assert "--only-cached" in command
        assert command[-2] == str(job_dir)
        assert command[-1] == str(job_dir / "resume.tex")
        assert kwargs["cwd"] == str(job_dir)
        assert kwargs["shell"] is False
        assert kwargs["check"] is False
        assert kwargs["timeout"] == 17
        assert kwargs["start_new_session"] is True
        assert kwargs["env"]["TECTONIC_UNTRUSTED_MODE"] == "1"
        assert "<job_dir>" in first.log or "<job_dir>" in second.log
        assert not job_dir.exists(), "temporary compile directory must be deleted"


@pytest.mark.asyncio
async def test_compile_copies_only_approved_assets_into_job(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "logo.txt").write_text("approved", encoding="utf-8")
    service = CompileService(tectonic_bin="tectonic-test")
    monkeypatch.setattr(service, "is_available", lambda: True)
    monkeypatch.setattr(compiler_module, "_read_page_count", lambda path: (1, None))
    monkeypatch.setattr(compiler_module, "_extract_pdf_text", lambda path: ("text", None))

    def fake_run(command, **kwargs):
        job_dir = Path(kwargs["cwd"])
        assert (job_dir / "assets" / "logo.txt").read_text(encoding="utf-8") == "approved"
        (job_dir / "resume.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(compiler_module.subprocess, "run", fake_run)

    result = await service.compile("safe source", assets)

    assert result.success is True


@pytest.mark.asyncio
async def test_compile_rejects_symlinked_assets_before_starting_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    target = tmp_path / "outside.txt"
    target.write_text("outside", encoding="utf-8")
    link = assets / "escape.txt"
    try:
        link.symlink_to(target)
    except (OSError, NotImplementedError):
        pytest.skip("symbolic links are unavailable on this platform")

    service = CompileService(tectonic_bin="tectonic-test")
    monkeypatch.setattr(service, "is_available", lambda: True)

    def must_not_run(*args, **kwargs):
        raise AssertionError("compiler must not start for symlinked assets")

    monkeypatch.setattr(compiler_module.subprocess, "run", must_not_run)

    result = await service.compile("safe source", assets)

    assert result.success is False
    assert result.error_code == "job_setup_failed"
    assert "symbolic links" in result.log


@pytest.mark.asyncio
async def test_compile_reports_unavailable_compiler_without_starting_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = CompileService(tectonic_bin="definitely-not-installed")
    monkeypatch.setattr(service, "is_available", lambda: False)

    def must_not_run(*args, **kwargs):
        raise AssertionError("subprocess must not run")

    monkeypatch.setattr(compiler_module.subprocess, "run", must_not_run)

    result = await service.compile("safe source")

    assert result.success is False
    assert result.error_code == "compiler_not_found"


@pytest.mark.asyncio
async def test_compile_rejects_oversized_source_before_starting_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = CompileService(tectonic_bin="tectonic-test")
    monkeypatch.setattr(service, "is_available", lambda: True)

    def must_not_run(*args, **kwargs):
        raise AssertionError("subprocess must not run")

    monkeypatch.setattr(compiler_module.subprocess, "run", must_not_run)

    result = await service.compile("x" * 2_000_001)

    assert result.success is False
    assert result.error_code == "source_too_large"


@pytest.mark.asyncio
async def test_compile_maps_timeout_without_leaking_temporary_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = CompileService(tectonic_bin="tectonic-test", timeout_seconds=10)
    monkeypatch.setattr(service, "is_available", lambda: True)

    def fake_timeout(command, **kwargs):
        raise subprocess.TimeoutExpired(
            command,
            kwargs["timeout"],
            output="working in {0}\x1b[31m".format(kwargs["cwd"]),
            stderr="timed out\x00",
        )

    monkeypatch.setattr(compiler_module.subprocess, "run", fake_timeout)

    result = await service.compile("safe source")

    assert result.success is False
    assert result.error_code == "compile_timeout"
    assert "<job_dir>" in result.log
    assert "resume-job-" not in result.log
    assert "\x1b" not in result.log
    assert "\x00" not in result.log


@pytest.mark.asyncio
async def test_compile_rejects_successful_process_without_a_valid_pdf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = CompileService(tectonic_bin="tectonic-test")
    monkeypatch.setattr(service, "is_available", lambda: True)

    def fake_run(command, **kwargs):
        Path(kwargs["cwd"], "resume.pdf").write_bytes(b"not-a-pdf")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(compiler_module.subprocess, "run", fake_run)

    result = await service.compile("safe source")

    assert result.success is False
    assert result.error_code == "invalid_pdf"


def test_log_sanitization_removes_paths_ansi_nuls_and_bounds_length(tmp_path: Path) -> None:
    raw = "{0}\x1b[31m secret\x00 {1}".format(tmp_path, "x" * 20_000)

    sanitized = _sanitize_log(raw, tmp_path)

    assert str(tmp_path) not in sanitized
    assert "\x1b" not in sanitized
    assert "\x00" not in sanitized
    assert len(sanitized) <= compiler_module.MAX_LOG_CHARACTERS

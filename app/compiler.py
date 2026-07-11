"""Isolated, bounded Tectonic compilation for deterministically rendered LaTeX."""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


MAX_LOG_CHARACTERS = 12_000
MAX_PDF_BYTES = 25_000_000
MAX_ASSET_BYTES = 25_000_000


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


@dataclass
class CompileResult:
    success: bool
    pdf_bytes: Optional[bytes] = None
    page_count: Optional[int] = None
    extracted_text: str = ""
    warnings: List[str] = field(default_factory=list)
    log: str = ""
    error_code: Optional[str] = None


class CompileService:
    """Compile one approved source at a time in unique temporary directories."""

    def __init__(
        self,
        tectonic_bin: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
        concurrency: Optional[int] = None,
        only_cached: Optional[bool] = None,
        max_pages: Optional[int] = None,
    ) -> None:
        self.tectonic_bin = tectonic_bin or os.getenv("TECTONIC_BIN", "tectonic")
        self.timeout_seconds = timeout_seconds or _env_int(
            "COMPILE_TIMEOUT_SECONDS", 90, 10, 180
        )
        self.concurrency = concurrency or _env_int("COMPILE_CONCURRENCY", 1, 1, 4)
        self.only_cached = (
            _env_bool("TECTONIC_ONLY_CACHED", True)
            if only_cached is None
            else only_cached
        )
        self.max_pages = max_pages or _env_int("MAX_PDF_PAGES", 1, 1, 10)
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._semaphore_loop: Optional[asyncio.AbstractEventLoop] = None

    def is_available(self) -> bool:
        return shutil.which(self.tectonic_bin) is not None

    def command_preview(self) -> List[str]:
        command = [self.tectonic_bin, "-X", "compile", "--untrusted"]
        if self.only_cached:
            command.append("--only-cached")
        command.extend(["--outdir", "<job_dir>", "<job_dir>/resume.tex"])
        return command

    async def compile(self, latex_source: str, assets_dir: Optional[Path] = None) -> CompileResult:
        loop = asyncio.get_running_loop()
        if self._semaphore is None or self._semaphore_loop is not loop:
            self._semaphore = asyncio.Semaphore(self.concurrency)
            self._semaphore_loop = loop
        async with self._semaphore:
            return await loop.run_in_executor(
                None, self._compile_sync, latex_source, assets_dir
            )

    def _compile_sync(self, latex_source: str, assets_dir: Optional[Path]) -> CompileResult:
        if not self.is_available():
            return CompileResult(
                success=False,
                error_code="compiler_not_found",
                log=(
                    "Tectonic was not found. Install it locally or run the provided Docker image."
                ),
            )
        if len(latex_source.encode("utf-8")) > 2_000_000:
            return CompileResult(
                success=False,
                error_code="source_too_large",
                log="Rendered LaTeX exceeded the 2 MB safety limit.",
            )

        with tempfile.TemporaryDirectory(prefix="resume-job-") as temporary:
            job_dir = Path(temporary)
            try:
                _copy_approved_assets(assets_dir, job_dir)
                tex_path = job_dir / "resume.tex"
                tex_path.write_text(latex_source, encoding="utf-8")
            except (OSError, ValueError) as exc:
                return CompileResult(
                    success=False,
                    error_code="job_setup_failed",
                    log="Could not prepare the isolated compile job: {0}".format(exc),
                )

            command = [
                self.tectonic_bin,
                "-X",
                "compile",
                "--untrusted",
            ]
            if self.only_cached:
                command.append("--only-cached")
            command.extend(["--outdir", str(job_dir), str(tex_path)])
            environment = os.environ.copy()
            environment["TECTONIC_UNTRUSTED_MODE"] = "1"

            try:
                completed = subprocess.run(
                    command,
                    cwd=str(job_dir),
                    env=environment,
                    capture_output=True,
                    text=True,
                    errors="replace",
                    timeout=self.timeout_seconds,
                    check=False,
                    shell=False,
                    start_new_session=True,
                    preexec_fn=_resource_limiter(self.timeout_seconds),
                )
            except subprocess.TimeoutExpired as exc:
                output = "{0}\n{1}".format(exc.stdout or "", exc.stderr or "")
                return CompileResult(
                    success=False,
                    error_code="compile_timeout",
                    log=_sanitize_log(output, job_dir)
                    or "Tectonic exceeded the {0}-second timeout.".format(
                        self.timeout_seconds
                    ),
                )
            except OSError as exc:
                return CompileResult(
                    success=False,
                    error_code="compiler_start_failed",
                    log="Tectonic could not start: {0}".format(exc),
                )

            log = _sanitize_log(
                "{0}\n{1}".format(completed.stdout, completed.stderr), job_dir
            )
            pdf_path = job_dir / "resume.pdf"
            if completed.returncode != 0:
                return CompileResult(
                    success=False,
                    error_code="latex_compile_failed",
                    log=log or "Tectonic exited with status {0}.".format(completed.returncode),
                )
            if not pdf_path.is_file():
                return CompileResult(
                    success=False,
                    error_code="pdf_missing",
                    log=log or "Tectonic completed without creating resume.pdf.",
                )
            try:
                pdf_size = pdf_path.stat().st_size
                if pdf_size <= 5 or pdf_size > MAX_PDF_BYTES:
                    raise ValueError("PDF size is outside the safety limits")
                pdf_bytes = pdf_path.read_bytes()
            except (OSError, ValueError) as exc:
                return CompileResult(
                    success=False,
                    error_code="invalid_pdf",
                    log="Compiled PDF could not be accepted: {0}".format(exc),
                )
            if not pdf_bytes.startswith(b"%PDF-"):
                return CompileResult(
                    success=False,
                    error_code="invalid_pdf",
                    log="Compiled output does not have a valid PDF signature.",
                )

            warnings: List[str] = []
            page_count, page_warning = _read_page_count(pdf_path)
            if page_warning:
                warnings.append(page_warning)
            if page_count is not None and page_count > self.max_pages:
                warnings.append(
                    "Generated PDF has {0} pages; the configured target is {1}.".format(
                        page_count, self.max_pages
                    )
                )

            extracted_text, text_warning = _extract_pdf_text(pdf_path)
            if text_warning:
                warnings.append(text_warning)
            if not extracted_text.strip() and not text_warning:
                warnings.append(
                    "No selectable text was extracted; verify ATS readability before using this PDF."
                )

            return CompileResult(
                success=True,
                pdf_bytes=pdf_bytes,
                page_count=page_count,
                extracted_text=extracted_text[:8_000],
                warnings=warnings,
                log=log,
            )


def _copy_approved_assets(assets_dir: Optional[Path], job_dir: Path) -> None:
    if assets_dir is None:
        return
    source = Path(assets_dir)
    if not source.exists():
        return
    if not source.is_dir() or source.is_symlink():
        raise ValueError("assets path must be a real directory")

    total_size = 0
    for path in source.rglob("*"):
        if path.is_symlink():
            raise ValueError("symbolic links are not allowed in resume assets")
        if path.is_file():
            total_size += path.stat().st_size
            if total_size > MAX_ASSET_BYTES:
                raise ValueError("resume assets exceed the 25 MB safety limit")
    shutil.copytree(str(source), str(job_dir / "assets"), symlinks=False)


def _resource_limiter(timeout_seconds: int):
    """Return a POSIX pre-exec resource limiter, or None where unavailable."""

    if os.name != "posix":  # pragma: no cover - production and CI use Linux/macOS
        return None
    try:
        import resource
    except ImportError:  # pragma: no cover
        return None

    def limit() -> None:
        cpu_limit = max(10, min(180, timeout_seconds + 5))
        memory_limit = _env_int(
            "COMPILE_MEMORY_LIMIT_MB", 2_048, 256, 8_192
        ) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_PDF_BYTES, MAX_PDF_BYTES))
        resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
        # RLIMIT_AS is reliable on Linux but can interfere with macOS system
        # frameworks, so apply the production memory bound only on Linux.
        if os.uname().sysname.lower() == "linux":
            resource.setrlimit(resource.RLIMIT_AS, (memory_limit, memory_limit))

    return limit


def _sanitize_log(output: str, job_dir: Path) -> str:
    output = output.replace(str(job_dir), "<job_dir>")
    output = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", output)
    output = output.replace("\x00", "")
    output = output.strip()
    if len(output) > MAX_LOG_CHARACTERS:
        return output[-MAX_LOG_CHARACTERS:]
    return output


def _run_inspector(command: List[str], timeout: int = 10) -> Tuple[int, str, str]:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
            check=False,
            shell=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return -1, "", str(exc)
    return result.returncode, result.stdout, result.stderr


def _read_page_count(pdf_path: Path) -> Tuple[Optional[int], Optional[str]]:
    if shutil.which("pdfinfo") is None:
        return None, "pdfinfo is unavailable, so page count was not verified."
    code, output, error = _run_inspector(["pdfinfo", str(pdf_path)])
    if code != 0:
        return None, "pdfinfo could not verify the generated page count: {0}".format(
            re.sub(r"\s+", " ", error).strip()[:200]
        )
    match = re.search(r"^Pages:\s*(\d+)\s*$", output, flags=re.MULTILINE)
    if not match:
        return None, "pdfinfo returned no page count."
    return int(match.group(1)), None


def _extract_pdf_text(pdf_path: Path) -> Tuple[str, Optional[str]]:
    if shutil.which("pdftotext") is None:
        return "", "pdftotext is unavailable, so ATS readability was not verified."
    code, output, error = _run_inspector(["pdftotext", "-layout", str(pdf_path), "-"])
    if code != 0:
        return "", "pdftotext could not inspect ATS readability: {0}".format(
            re.sub(r"\s+", " ", error).strip()[:200]
        )
    return output.strip(), None


async def compile_latex(
    latex_source: str,
    assets_dir: Optional[Path] = None,
    service: Optional[CompileService] = None,
) -> CompileResult:
    """Convenience function exposed for tests and CLI-style callers."""

    compiler = service or CompileService()
    return await compiler.compile(latex_source, assets_dir)

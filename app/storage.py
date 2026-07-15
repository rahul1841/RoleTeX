"""Per-user resume storage: one UUID-keyed directory per imported profile.

Each profile lives in ``<base>/<uuid>/`` with:
  data.json     validated ResumeData facts (the tailoring source)
  template.tex  server-controlled, style-personalized locked template
  source.tex    the raw pasted LaTeX, retained for future exact-fidelity work
  meta.json     provider/model/style/timestamp bookkeeping

The directory name is a canonical UUID4 hex string, so an id from an untrusted
request can never traverse outside the base directory.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .resume import PROJECT_ROOT, ResumeError, load_resume_data, validate_template
from .schemas import ResumeData, ResumeStyle, dump_model


MAX_SOURCE_BYTES = 400_000
MAX_TEMPLATE_BYTES = 2_000_000


class ResumeStoreError(ResumeError):
    """Raised when a stored profile is missing, unreadable, or malformed."""


def _is_valid_id(resume_id: str) -> bool:
    try:
        return uuid.UUID(resume_id).hex == resume_id
    except (ValueError, AttributeError, TypeError):
        return False


@dataclass
class StoredResume:
    id: str
    data: ResumeData
    template: str


class UserResumeStore:
    """Filesystem-backed store with no import-time I/O (easy to swap in tests)."""

    def __init__(self, base_dir: Optional[Path] = None) -> None:
        self.base_dir = Path(
            base_dir or os.getenv("USER_DATA_DIR", str(PROJECT_ROOT / "data"))
        )

    def _user_dir(self, resume_id: str) -> Path:
        if not _is_valid_id(resume_id):
            raise ResumeStoreError("Invalid resume id")
        return self.base_dir / resume_id

    def exists(self, resume_id: str) -> bool:
        try:
            return (self._user_dir(resume_id) / "data.json").is_file()
        except ResumeStoreError:
            return False

    def create(
        self,
        data: ResumeData,
        template: str,
        source_latex: str,
        style: ResumeStyle,
        provider: str,
        model: str,
    ) -> str:
        """Persist a new profile atomically and return its generated id."""

        if len(source_latex.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise ResumeStoreError("Pasted resume source exceeds the safety limit")
        if len(template.encode("utf-8")) > MAX_TEMPLATE_BYTES:
            raise ResumeStoreError("Generated template exceeds the safety limit")
        validate_template(template)

        resume_id = uuid.uuid4().hex
        user_dir = self.base_dir / resume_id
        user_dir.mkdir(parents=True, exist_ok=True)

        meta = {
            "id": resume_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "provider": provider,
            "model": model,
            "style": dump_model(style),
        }
        _atomic_write(user_dir / "data.json", json.dumps(dump_model(data), ensure_ascii=False, indent=2))
        _atomic_write(user_dir / "template.tex", template)
        _atomic_write(user_dir / "source.tex", source_latex)
        _atomic_write(user_dir / "meta.json", json.dumps(meta, ensure_ascii=False, indent=2))
        return resume_id

    def load(self, resume_id: str) -> Tuple[ResumeData, str]:
        """Load and re-validate a stored profile's data and template."""

        user_dir = self._user_dir(resume_id)
        data_path = user_dir / "data.json"
        template_path = user_dir / "template.tex"
        if not data_path.is_file() or not template_path.is_file():
            raise ResumeStoreError("No stored resume for id {0}".format(resume_id))

        data = load_resume_data(data_path)
        try:
            template = template_path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise ResumeStoreError("Stored template could not be read") from exc
        validate_template(template)
        return data, template

    def load_meta(self, resume_id: str) -> Dict[str, Any]:
        user_dir = self._user_dir(resume_id)
        meta_path = user_dir / "meta.json"
        if not meta_path.is_file():
            raise ResumeStoreError("No metadata for id {0}".format(resume_id))
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ResumeStoreError("Stored metadata could not be read") from exc


def _atomic_write(path: Path, content: str) -> None:
    directory = path.parent
    handle = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=str(directory), delete=False, suffix=".tmp"
    )
    try:
        with handle as stream:
            stream.write(content)
        os.replace(handle.name, str(path))
    except OSError:
        try:
            os.unlink(handle.name)
        except OSError:
            pass
        raise

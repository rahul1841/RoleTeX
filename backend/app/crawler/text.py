"""Posting HTML to plain text.

Descriptions are stored and shown as text only: the UI never renders a
posting's HTML, so a hostile posting cannot run script in RoleTeX. Paragraph,
heading and list structure survive as line breaks and "- " bullets because the
experience parser reads requirements line by line.
"""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from typing import List


#: Same ceiling as a saved job description (``JdCreateRequest.content``).
MAX_DESCRIPTION_CHARACTERS = 20_000

_BLOCK_TAGS = frozenset(
    (
        "address", "article", "aside", "blockquote", "br", "dd", "div", "dl",
        "dt", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
        "main", "ol", "p", "pre", "section", "table", "tr", "ul",
    )
)
_SKIP_TAGS = frozenset(("script", "style", "noscript", "template", "svg", "head", "iframe"))
_SPACE_RUN = re.compile(r"[ \t\f\v ​]+")
_BLANK_RUN = re.compile(r"\n{3,}")


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag in ("td", "th"):
            self.parts.append(" ")
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in _BLOCK_TAGS or tag == "li":
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


def clean_text(text: str, limit: int = MAX_DESCRIPTION_CHARACTERS) -> str:
    """Normalize whitespace in already-plain text and cap it."""

    text = (text or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [_SPACE_RUN.sub(" ", line).strip() for line in text.split("\n")]
    joined = _BLANK_RUN.sub("\n\n", "\n".join(lines)).strip()
    return joined[:limit]


def html_to_text(markup: str, limit: int = MAX_DESCRIPTION_CHARACTERS) -> str:
    """Strip tags (and script/style content), keeping block structure."""

    if not markup:
        return ""
    parser = _TextExtractor()
    try:
        parser.feed(markup)
        parser.close()
    except Exception:  # HTMLParser is lenient; anything else falls back to tag-stripping
        return clean_text(re.sub(r"<[^>]+>", " ", html.unescape(markup)), limit)
    return clean_text("".join(parser.parts), limit)


def escaped_html_to_text(markup: str, limit: int = MAX_DESCRIPTION_CHARACTERS) -> str:
    """For feeds that HTML-escape their HTML (Greenhouse's ``content``)."""

    return html_to_text(html.unescape(markup or ""), limit)

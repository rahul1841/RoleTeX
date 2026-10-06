"""SSRF-safe outbound HTTP for the crawler.

Security rationale:
- Users type the links this module fetches, so it is a server-side request
  forgery surface. Only ``http``/``https`` on ports 80/443 without userinfo are
  allowed; the host is resolved here and every address must be public
  (loopback, private, link-local — cloud metadata at 169.254.169.254 — CGNAT,
  multicast and reserved ranges are refused, IPv4-mapped IPv6 included).
- The connection goes to the address that was checked, never to the name
  again: the request URL carries the IP, ``Host`` carries the name, and TLS
  uses the name for SNI and certificate checks (httpx's ``sni_hostname``). A
  DNS answer that changes between check and connect (rebinding) cannot reach
  an internal address.
- Connections are pooled per hostname only. Two hosts behind one CDN address
  must never share a TLS connection, or a request for one would ride a
  session negotiated for the other.
- Redirects are followed by hand, at most five, and each hop is re-checked.
- Bodies are read as a stream and cut off at a byte cap (after decompression,
  so a gzip bomb is bounded too); every request has a timeout.
- No cookies, no auth headers and no proxy environment (``trust_env=False``).
- Requests to one host are serialized with a short gap, and ``robots.txt``
  is honoured for HTML pages (fetched through this same guard, never via
  ``RobotFileParser.read``, which would bypass it).
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import socket
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx


logger = logging.getLogger(__name__)

MAX_REDIRECTS = 5
#: Gap between two requests to the same host.
HOST_DELAY_SECONDS = 1.0
#: Transient failures (429/5xx, network) are retried this many extra times.
RETRIES = 1
MAX_RETRY_AFTER_SECONDS = 10.0
_REDIRECT_STATUSES = (301, 302, 303, 307, 308)
_DEFAULT_PORTS = {"http": 80, "https": 443}


class FetchError(RuntimeError):
    """A crawl request that could not complete; ``code`` is stable.

    Codes: ``blocked_url``, ``blocked_host``, ``dns_failed``, ``too_large``,
    ``timeout``, ``network``, ``too_many_redirects``, ``http_status``,
    ``bad_json``, ``robots_disallowed``.
    """

    def __init__(self, message: str, code: str, status_code: Optional[int] = None) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(message)


@dataclass(frozen=True)
class FetchResponse:
    status_code: int
    #: Final URL after redirects, with the hostname (not the pinned address).
    url: str
    content_type: str
    body: bytes

    def text(self) -> str:
        charset = "utf-8"
        for part in self.content_type.split(";")[1:]:
            name, _, value = part.strip().partition("=")
            if name.lower() == "charset" and value:
                charset = value.strip().strip('"')
        try:
            return self.body.decode(charset, errors="replace")
        except LookupError:
            return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        try:
            return json.loads(self.body.decode("utf-8", errors="replace"))
        except (ValueError, RecursionError) as exc:
            raise FetchError("The response was not valid JSON", "bad_json") from exc


def is_public_address(address: str) -> bool:
    """True only for globally routable unicast addresses."""

    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif ip.sixtofour is not None:
            ip = ip.sixtofour
    return bool(
        ip.is_global
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_private
        and not ip.is_unspecified
    )


def check_url(url: str) -> Tuple[str, str, int, str]:
    """Validate a URL's shape; returns ``(scheme, host, port, path_and_query)``."""

    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise FetchError("The link is not a valid URL", "blocked_url") from exc
    scheme = (parts.scheme or "").lower()
    if scheme not in _DEFAULT_PORTS:
        raise FetchError("Only http and https links can be crawled", "blocked_url")
    if parts.username or parts.password:
        raise FetchError("Links with credentials are not crawled", "blocked_url")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise FetchError("The link has no host", "blocked_url")
    try:
        port = parts.port or _DEFAULT_PORTS[scheme]
    except ValueError as exc:
        raise FetchError("The link has an invalid port", "blocked_url") from exc
    if port not in (80, 443):
        raise FetchError("Only the standard web ports are crawled", "blocked_url")
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    if any(ord(character) < 33 for character in path):
        raise FetchError("The link contains control characters", "blocked_url")
    return scheme, host, port, path


class SafeFetcher:
    """One crawl's HTTP client set; create per cycle and ``close`` afterwards."""

    def __init__(
        self,
        timeout_seconds: float,
        max_bytes: int,
        user_agent: str,
        host_delay_seconds: float = HOST_DELAY_SECONDS,
    ) -> None:
        self.timeout_seconds = float(timeout_seconds)
        self.max_bytes = int(max_bytes)
        self.user_agent = user_agent
        self.host_delay_seconds = float(host_delay_seconds)
        self._clients: Dict[str, httpx.AsyncClient] = {}
        self._host_locks: Dict[str, asyncio.Lock] = {}
        self._host_last: Dict[str, float] = {}
        self._robots: Dict[str, Optional[RobotFileParser]] = {}

    async def close(self) -> None:
        clients = list(self._clients.values())
        self._clients.clear()
        for client in clients:
            try:
                await client.aclose()
            except Exception:  # closing is best-effort
                pass

    # -- public helpers -----------------------------------------------------

    async def get(self, url: str, accept: str = "*/*") -> FetchResponse:
        return await self.request("GET", url, headers={"Accept": accept})

    async def get_json(self, url: str) -> Any:
        response = await self.request("GET", url, headers={"Accept": "application/json"})
        _require_ok(response)
        return response.json()

    async def post_json(self, url: str, payload: Any) -> Any:
        response = await self.request(
            "POST",
            url,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            body=json.dumps(payload).encode("utf-8"),
        )
        _require_ok(response)
        return response.json()

    async def get_page(self, url: str) -> FetchResponse:
        """An HTML page, refused when its site's robots.txt disallows us."""

        if not await self.robots_allow(url):
            raise FetchError("The site's robots.txt does not allow crawling this page", "robots_disallowed")
        response = await self.request(
            "GET", url, headers={"Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"}
        )
        _require_ok(response)
        return response

    async def robots_allow(self, url: str) -> bool:
        scheme, host, port, _ = check_url(url)
        origin = "{0}://{1}".format(scheme, host if port == _DEFAULT_PORTS[scheme] else "{0}:{1}".format(host, port))
        if origin not in self._robots:
            parser: Optional[RobotFileParser] = RobotFileParser()
            try:
                response: Optional[FetchResponse] = await self.request(
                    "GET", origin + "/robots.txt", headers={"Accept": "text/plain"}
                )
            except FetchError as exc:
                if exc.code != "too_large":
                    # The page itself would fail the same way; report that.
                    raise
                response = None
            if response is None:
                parser.parse([])
            elif response.status_code >= 500:
                # RFC 9309: a server error on robots.txt means "assume disallowed".
                parser = None
            elif response.status_code >= 400:
                parser.parse([])  # missing robots.txt: everything allowed
            else:
                parser.parse(response.text().splitlines()[:5_000])
            self._robots[origin] = parser
        parser = self._robots[origin]
        if parser is None:
            return False
        return parser.can_fetch(self.user_agent, url)

    # -- core ---------------------------------------------------------------

    async def request(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        body: Optional[bytes] = None,
    ) -> FetchResponse:
        current = url
        current_method = method.upper()
        current_body = body
        for _ in range(MAX_REDIRECTS + 1):
            response, location = await self._request_with_retries(
                current_method, current, headers or {}, current_body
            )
            if location is None:
                return response
            current = urljoin(current, location)
            if response.status_code == 303 or (
                response.status_code in (301, 302) and current_method == "POST"
            ):
                current_method = "GET"
                current_body = None
        raise FetchError("The link redirected too many times", "too_many_redirects")

    async def _request_with_retries(
        self, method: str, url: str, headers: Dict[str, str], body: Optional[bytes]
    ) -> Tuple[FetchResponse, Optional[str]]:
        attempt = 0
        while True:
            attempt += 1
            try:
                response, location, retry_after = await self._request_once(
                    method, url, headers, body
                )
            except FetchError as exc:
                if exc.code in ("timeout", "network") and attempt <= RETRIES:
                    await asyncio.sleep(1.0)
                    continue
                raise
            if (response.status_code == 429 or response.status_code >= 500) and attempt <= RETRIES:
                await asyncio.sleep(min(MAX_RETRY_AFTER_SECONDS, retry_after or 2.0))
                continue
            return response, location

    async def _resolve(self, host: str, port: int) -> str:
        try:
            ipaddress.ip_address(host)
            candidates = [host]
        except ValueError:
            loop = asyncio.get_running_loop()
            try:
                infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            except (socket.gaierror, UnicodeError) as exc:
                raise FetchError("The link's host could not be resolved", "dns_failed") from exc
            candidates = [info[4][0] for info in infos]
        if not candidates:
            raise FetchError("The link's host could not be resolved", "dns_failed")
        # Every answer must be public: picking a "good" one out of a mixed set
        # would let an attacker steer the choice.
        if not all(is_public_address(address) for address in candidates):
            raise FetchError("The link points at a private or reserved address", "blocked_host")
        ipv4 = [address for address in candidates if ":" not in address]
        return (ipv4 or candidates)[0]

    async def _request_once(
        self, method: str, url: str, headers: Dict[str, str], body: Optional[bytes]
    ) -> Tuple[FetchResponse, Optional[str], Optional[float]]:
        scheme, host, port, path = check_url(url)
        address = await self._resolve(host, port)
        target = address if ":" not in address else "[{0}]".format(address)
        default_port = _DEFAULT_PORTS[scheme]
        port_suffix = "" if port == default_port else ":{0}".format(port)
        request_url = "{0}://{1}{2}{3}".format(scheme, target, port_suffix, path)
        request_headers = dict(headers)
        request_headers["Host"] = host + port_suffix
        request_headers["User-Agent"] = self.user_agent
        extensions: Dict[str, Any] = {}
        if scheme == "https":
            extensions["sni_hostname"] = host

        client = self._clients.get(host)
        if client is None:
            client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout_seconds),
                follow_redirects=False,
                trust_env=False,
            )
            self._clients[host] = client
        lock = self._host_locks.setdefault(host, asyncio.Lock())

        async with lock:
            wait = self._host_last.get(host, 0.0) + self.host_delay_seconds - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                result = await asyncio.wait_for(
                    self._send(client, method, request_url, request_headers, body, extensions, url),
                    timeout=self.timeout_seconds * 4,
                )
            except asyncio.TimeoutError as exc:
                raise FetchError("The site took too long to answer", "timeout") from exc
            finally:
                self._host_last[host] = time.monotonic()
        return result

    async def _send(
        self,
        client: httpx.AsyncClient,
        method: str,
        request_url: str,
        headers: Dict[str, str],
        body: Optional[bytes],
        extensions: Dict[str, Any],
        original_url: str,
    ) -> Tuple[FetchResponse, Optional[str], Optional[float]]:
        try:
            async with client.stream(
                method, request_url, headers=headers, content=body, extensions=extensions
            ) as response:
                location = None
                if response.status_code in _REDIRECT_STATUSES:
                    location = response.headers.get("location")
                retry_after = _retry_after(response.headers.get("retry-after"))
                chunks: List[bytes] = []
                total = 0
                if location is None:
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > self.max_bytes:
                            raise FetchError("The response is larger than the crawl limit", "too_large")
                        chunks.append(chunk)
                return (
                    FetchResponse(
                        status_code=response.status_code,
                        url=original_url,
                        content_type=response.headers.get("content-type", ""),
                        body=b"".join(chunks),
                    ),
                    location,
                    retry_after,
                )
        except httpx.TimeoutException as exc:
            raise FetchError("The site took too long to answer", "timeout") from exc
        except httpx.HTTPError as exc:
            # The class name only: messages can embed the pinned address.
            raise FetchError("The site could not be reached ({0})".format(type(exc).__name__), "network") from exc


def _retry_after(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _require_ok(response: FetchResponse) -> None:
    if not 200 <= response.status_code < 300:
        raise FetchError(
            "The site answered HTTP {0}".format(response.status_code),
            "http_status",
            status_code=response.status_code,
        )

"""ESPN logos and headshots, cached to disk and inlined as data URIs.

    from on_the_clock.images import logo, headshot

**Why inline and not hot-link.** Two reasons, and only one of them is the
platform. A published Artifact runs under a CSP that blocks every external host,
so a remote `<img src>` is simply a broken image there. But the draft-room copy
served over Tailscale has no such rule and would still be the wrong call: a
phone on a soft connection in somebody's basement should not be fetching a
hundred portraits from a CDN while a pick is on the clock. Bytes in the file are
bytes that cannot fail. The whole page is one request either way.

Sizes come from ESPN's own combiner rather than a local image library, so this
stays a stdlib-plus-httpx script with no Pillow in the dependency list.
"""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

import httpx

from . import config

COMBINER = "https://a.espncdn.com/combiner/i?img={path}&w={w}&h={h}"
HEADSHOT = "/i/headshots/nfl/players/full/{pid}.png"

# A missing headshot comes back as ESPN's grey silhouette. It is the same bytes
# every time, so one hash identifies every player the CDN has no picture of.
_placeholders: set[str] = set()


def _cache() -> Path:
    return config.workdir() / "data" / "cache" / "img"


def _fetch(url: str, key: str) -> bytes | None:
    cache = _cache()
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"{key}.png"
    if path.exists():
        return path.read_bytes() or None
    try:
        r = httpx.get(url, follow_redirects=True, timeout=30)
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or not r.content.startswith(b"\x89PNG"):
        path.write_bytes(b"")  # negative-cache so a rerun does not re-ask
        return None
    path.write_bytes(r.content)
    return r.content


def _uri(data: bytes | None) -> str:
    if not data:
        return ""
    return "data:image/png;base64," + base64.b64encode(data).decode()


def logo(espn_url: str, team: str, size: int = 150, dark: bool = False) -> str:
    """One team logo. `dark` asks ESPN for its light-on-dark variant.

    ESPN publishes a 500-dark alternative for the handful of clubs whose mark
    disappears on a dark ground — the Raiders and the Jets among them — and
    returns the identical file for everyone else, so asking for it costs nothing
    and the caller can compare the two.
    """
    path = espn_url.split(".com")[-1]
    if dark:
        path = path.replace("/nfl/500/", "/nfl/500-dark/")
    url = COMBINER.format(path=path, w=size, h=size)
    return _uri(_fetch(url, f"logo-{team.lower()}-{size}{'-dark' if dark else ''}"))


def headshot(pid: str, w: int = 220) -> str:
    """One player portrait, or "" when ESPN has no picture of him.

    Rookies and camp bodies routinely have none, and ESPN answers with a generic
    silhouette rather than a 404. Returning "" for those lets the page fall back
    to a jersey-number tile instead of printing the same grey stranger fifteen
    times.
    """
    if not pid:
        return ""
    url = COMBINER.format(path=HEADSHOT.format(pid=pid), w=w, h=int(w * 0.725))
    data = _fetch(url, f"head-{pid}-{w}")
    if not data:
        return ""
    digest = hashlib.md5(data).hexdigest()
    if digest in _placeholders:
        return ""
    return _uri(data)


def learn_placeholder(pid: str, w: int = 220) -> None:
    """Record the silhouette ESPN serves for an id it has no photo for."""
    url = COMBINER.format(path=HEADSHOT.format(pid=pid), w=w, h=int(w * 0.725))
    data = _fetch(url, f"head-{pid}-{w}")
    if data:
        _placeholders.add(hashlib.md5(data).hexdigest())

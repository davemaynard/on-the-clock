"""Local draft server: the board, plus ESPN's live picks folded into it.

The published artifact can never do this. Its CSP blocks every external host but
Google Fonts, and reaching ESPN needs private cookies that must not live in a
published page. A box on your own network has both, so this is the only place
auto-sync can happen.

    on-the-clock serve                 # http://<this box>:8777 over Tailscale / LAN

What it adds over the artifact:
  * polls ESPN's draft detail and marks players off as they are actually taken
  * knows which picks are yours (by teamId), so your roster fills itself
  * takes the current pick straight from ESPN rather than counting checkboxes

Manual tapping still works and still wins: the sync only ever *adds* picks it
sees. That matters for the offline league, where ESPN only knows what the
commissioner has typed in, and may know it late or not at all.

Where the picks come from: ESPN's REST feed lists every pick with player -1
until the draft is over, so while a draft is in progress the feed joins the
draft room's own socket (room.py) and reads picks from there, the moment they
are made. The REST side still supplies the draft order and the done flag.

Standard library plus httpx and websockets, on purpose: one user, a handful of
endpoints, and nothing else to install the night before a draft.
"""

from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import threading
import time
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

from . import config, page, room

HOST = "https://lm-api-reads.fantasy.espn.com"
POLL_TTL = 4.0  # seconds; ESPN is not ours to hammer


def is_real_pick(player_id: int) -> bool:
    """D/ST ids are negative (-16000 - proTeamId, e.g. Lions -16008), so a
    `> 0` filter silently drops every D/ST pick. Only the live-draft
    placeholder (-1) and 0 are ghosts."""
    return player_id not in (-1, 0)


class DraftFeed:
    """Cached read of one league's live draft, shared across requests."""

    def __init__(self, cookies: dict, year: int, teams: dict[str, int] | None = None) -> None:
        self.cookies = cookies
        self.year = year
        # league id -> your team id, from the page build; needed to join a draft room.
        self.teams = teams or {}
        self.rooms: dict[str, room.Room] = {}
        self._cache: dict[str, tuple[float, dict]] = {}
        self._lock = threading.Lock()

    def _room(self, league_id: str) -> room.Room | None:
        """The league's draft room, started on first use. None without a team id."""
        team_id = self.teams.get(league_id)
        if not team_id:
            return None
        with self._lock:
            live = self.rooms.get(league_id)
            if live is None:
                live = room.Room(self.cookies, self.year, league_id, team_id)
                live.start()
                self.rooms[league_id] = live
            return live

    def _close_room(self, league_id: str) -> None:
        with self._lock:
            live = self.rooms.pop(league_id, None)
        if live:
            live.close()

    def get(self, league_id: str) -> dict:
        now = time.monotonic()
        with self._lock:
            hit = self._cache.get(league_id)
            if hit and now - hit[0] < POLL_TTL:
                return hit[1]
        try:
            data = self._fetch(league_id)
        except Exception as exc:  # a dead feed must not take the board down
            data = {"ok": False, "error": str(exc), "picks": [], "inProgress": False}
        with self._lock:
            self._cache[league_id] = (now, data)
        return data

    def _fetch(self, league_id: str) -> dict:
        r = httpx.get(
            f"{HOST}/apis/v3/games/ffl/seasons/{self.year}/segments/0/leagues/{league_id}",
            params=[("view", "mDraftDetail"), ("view", "mSettings")],
            cookies=self.cookies,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        detail = data.get("draftDetail", {}) or {}
        picks = [
            {"overall": p["overallPickNumber"], "player": p["playerId"], "team": p["teamId"]}
            for p in (detail.get("picks") or [])
            if is_real_pick(p.get("playerId", -1))
        ]
        # The draft order, for leagues that randomize it shortly before the
        # draft (orderType DRAFT_START). Trust gates: before availableDate the
        # order is a placeholder; and a DRAFT_START order that still reads
        # 1..N is indistinguishable from the placeholder, so it stays
        # untrusted: the tracker falls back to reading your own
        # first-round pick, or the manual slot picker.
        ds = (data.get("settings") or {}).get("draftSettings") or {}
        order = ds.get("pickOrder") or []
        order_final = bool(order)
        if ds.get("orderType") == "DRAFT_START":
            avail = ds.get("availableDate")
            if avail and time.time() * 1000 < avail:
                order_final = False
            if order == list(range(1, len(order) + 1)):
                order_final = False
        in_progress = bool(detail.get("inProgress"))
        drafted = bool(detail.get("drafted"))
        result = {
            "ok": True,
            "inProgress": in_progress,
            "drafted": drafted,
            "picks": picks,
            "pickOrder": order,
            "orderFinal": order_final,
            "onClock": (max((p["overall"] for p in picks), default=0) + 1),
            "source": "rest",
        }
        if drafted:
            self._close_room(league_id)
        elif in_progress and (live := self._room(league_id)) is not None:
            seen = live.snapshot()
            if seen["picks"]:
                # The room is the truth mid-draft; anything REST does know is kept.
                merged = {p["overall"]: p for p in picks}
                merged.update({p["overall"]: p for p in seen["picks"]})
                result["picks"] = [merged[k] for k in sorted(merged)]
                result["onClock"] = seen["onClock"] or (max(merged) + 1)
            result["source"] = f"room:{seen['state']}"
            if seen["error"]:
                result["roomError"] = seen["error"]
        return result


# Static pages served alongside the draft room: any .html in out/ is reachable
# at /<name> (out/depth-report.html -> /depth-report). Read at request time
# rather than at boot, so regenerating a report does not mean restarting the
# server in the middle of a draft.
def extra_page(path: str) -> Path | None:
    name = path.strip("/")
    if not name or "/" in name or name.startswith("."):
        return None
    candidate = config.out_dir() / f"{name}.html"
    return candidate if candidate.exists() else None


def make_handler(page: bytes, feed: DraftFeed):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            if u.path in ("/", "/index.html"):
                self._send(200, page, "text/html; charset=utf-8")
            elif (extra := extra_page(u.path)) is not None:
                self._send(200, extra.read_bytes(), "text/html; charset=utf-8")
            elif u.path == "/api/draft":
                lid = (parse_qs(u.query).get("league") or [""])[0]
                if not lid.isdigit():
                    self._send(400, b'{"error":"bad league"}', "application/json")
                    return
                body = json.dumps(feed.get(lid)).encode()
                self._send(200, body, "application/json")
            elif u.path == "/healthz":
                self._send(200, b"ok", "text/plain")
            else:
                self._send(404, b"not found", "text/plain")

        def log_message(self, fmt: str, *args) -> None:
            if "/api/draft" not in self.path:  # polling would drown the log
                sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

    return Handler


def reachable_urls(port: int) -> list[str]:
    """Addresses this box can be reached on, Tailscale first.

    The hostname lookup does not surface the Tailscale address on macOS, so ask
    tailscale directly: that is the address that matters from a phone at a draft
    table, and printing only the LAN IP would be quietly useless there.
    """
    urls: list[str] = []
    try:
        out = subprocess.run(
            ["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=4
        ).stdout.strip()
        for line in out.splitlines():
            if line.strip():
                urls.append(f"http://{line.strip()}:{port}   <- Tailscale")
    except Exception:
        pass
    try:
        host = socket.gethostname()
        urls.append(f"http://{host}:{port}")
        for info in socket.getaddrinfo(host, None):
            ip = info[4][0]
            if ":" not in ip and not ip.startswith("127."):
                urls.append(f"http://{ip}:{port}")
    except Exception:
        pass
    urls.append(f"http://localhost:{port}")
    return list(dict.fromkeys(urls))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="on-the-clock serve")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--host", default="0.0.0.0", help="0.0.0.0 so Tailscale peers can reach it.")
    ap.add_argument("--year", type=int, default=date.today().year)
    args = ap.parse_args(argv)

    cookies = config.require_cookies()

    print("building board from ESPN…", flush=True)
    html, leagues = page.build_page(args.year, cookies, live=True)
    body = html.encode("utf-8")
    my_teams = {d["league_id"]: d["team"] for d in leagues if d.get("team")}
    feed = DraftFeed(cookies, args.year, my_teams)

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(body, feed))
    httpd.daemon_threads = True
    print(f"\nDraft room up on port {args.port}. Live sync ON.")
    for url in reachable_urls(args.port):
        print(f"  {url}")
    print("\nCtrl-C to stop.\n", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()

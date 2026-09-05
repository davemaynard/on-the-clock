"""ESPN's draft room, read live over the socket the room itself uses.

While a draft is running, ESPN's REST feed (`mDraftDetail`) lists every pick
slot with `playerId: -1`; the picks only appear once the draft is over. The
draft room in the browser gets them another way: a WebSocket on
fantasydraft.espn.com that every participant joins. Joining it a second time,
from here, does not disturb the seat in the browser; it was watched through a
whole live draft (2026-09-04) without a hiccup.

The protocol is small and plain text:

    INIT <base64>                     the whole draft state, sent once on connect
    SELECTED <team> <player> <n> {…}  a pick, the moment it is made
    SELECTING <team> <ms>             who is on the clock and their allowance
    CLOCK <?> <ms> <team>             the clock, every five seconds
    JOINED / LEFT / CHAT / AUTOSUGGEST / PONG   noise, ignored

Joining needs a one-time token from the REST side (`teams/<id>/draftSecurity`)
and your team id, both of which the board already knows.

Inside INIT, every pick slot is a 45-byte record: an 8-byte marker, the league
id, then team id, overall pick number and player id as big-endian int32, then
padding. A slot not yet drafted carries player -1. D/ST ids are negative, so
the player id is read signed. The same marker opens a set of shorter records
before the picks; those carry no plausible overall pick number and are skipped.
"""

from __future__ import annotations

import base64
import re
import struct
import threading
import time
from dataclasses import dataclass

import httpx

REST = "https://lm-api-reads.fantasy.espn.com"
SOCKET = "wss://fantasydraft.espn.com"
MARKER = b"\x00\x00\x00\x01\x00\x00\x00\x03"
PING_EVERY = 15.0
RECONNECT_WAIT = 5.0


@dataclass(frozen=True)
class Pick:
    overall: int
    team: int
    player: int

    def as_feed(self) -> dict:
        """The shape the browser reads: the same one the REST feed produces."""
        return {"overall": self.overall, "player": self.player, "team": self.team}


def draft_token(cookies: dict, year: int, league_id: str, team_id: int) -> str:
    r = httpx.get(
        f"{REST}/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}"
        f"/teams/{team_id}/draftSecurity",
        cookies=cookies,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=10,
    )
    r.raise_for_status()
    return r.text.strip()


def join_url(league_id: str, team_id: int, swid: str, token: str) -> str:
    identity = f"1:{league_id}:{team_id}:{swid}:{token}"
    return (
        f"{SOCKET}/game-1/league-{league_id}/JOIN?1=1&2={league_id}&3={team_id}"
        f"&4={swid}&5={identity}&6=false&7=false&8=KONA&nocache={int(time.time()) % 1_000_000}"
    )


def parse_init(payload: str, league_id: str, max_pick: int = 400) -> list[Pick]:
    """The picks made so far, from the base64 INIT payload, in draft order."""
    raw = base64.b64decode(payload.strip() + "==")
    marker = MARKER + struct.pack(">I", int(league_id))
    picks: dict[int, Pick] = {}
    for m in re.finditer(re.escape(marker), raw):
        at = m.end()
        if at + 12 > len(raw):
            break
        team, overall, player = struct.unpack(">iii", raw[at : at + 12])
        if 1 <= overall <= max_pick and 1 <= team <= 32 and player not in (0, -1):
            picks[overall] = Pick(overall, team, player)
    return [picks[k] for k in sorted(picks)]


def parse_frame(text: str) -> tuple[str, list[str]]:
    """A frame's kind and its fields. Chat and other noise come back too; the
    caller decides what to keep."""
    parts = text.strip().split()
    return (parts[0] if parts else "", parts[1:])


class Room(threading.Thread):
    """One league's draft room, followed on its own thread.

    `snapshot()` is what the feed merges: the picks known so far and who is on
    the clock. The thread reconnects on its own until `close()` or until the
    server tells it the draft is done.
    """

    def __init__(self, cookies: dict, year: int, league_id: str, team_id: int) -> None:
        super().__init__(daemon=True, name=f"draft-room-{league_id}")
        self.cookies = cookies
        self.year = year
        self.league_id = league_id
        self.team_id = team_id
        self.picks: dict[int, Pick] = {}
        self.on_clock: int | None = None
        self.state = "connecting"
        self.error = ""
        self._stop = threading.Event()
        self._lock = threading.Lock()

    # ---- state, for the feed ----------------------------------------------------
    def snapshot(self) -> dict:
        with self._lock:
            picks = [self.picks[k].as_feed() for k in sorted(self.picks)]
            return {
                "picks": picks,
                "onClock": self.on_clock,
                "state": self.state,
                "error": self.error,
            }

    def handle(self, text: str) -> None:
        """Fold one frame into the state. Pure bookkeeping, so it is testable
        without a socket."""
        kind, fields = parse_frame(text)
        with self._lock:
            if kind == "INIT" and fields:
                for pick in parse_init(fields[0], self.league_id):
                    self.picks[pick.overall] = pick
                self.state = "live"
            elif kind == "SELECTED" and len(fields) >= 2:
                # Picks arrive in draft order; the next overall number is the
                # one after the last we know.
                overall = (max(self.picks) if self.picks else 0) + 1
                self.picks[overall] = Pick(overall, int(fields[0]), int(fields[1]))
            elif kind == "SELECTING" and fields:
                self.on_clock = int(fields[0])
            elif kind == "CLOCK" and len(fields) >= 3:
                self.on_clock = int(fields[2])

    def close(self) -> None:
        self._stop.set()

    # ---- the socket ------------------------------------------------------------
    def run(self) -> None:
        from websockets.sync.client import connect

        while not self._stop.is_set():
            try:
                token = draft_token(self.cookies, self.year, self.league_id, self.team_id)
                url = join_url(self.league_id, self.team_id, self.cookies["SWID"], token)
                headers = {
                    "Origin": "https://fantasy.espn.com",
                    "User-Agent": "Mozilla/5.0",
                    "Cookie": f"espn_s2={self.cookies['espn_s2']}; SWID={self.cookies['SWID']}",
                }
                with connect(url, additional_headers=headers) as ws:
                    last_ping = time.monotonic()
                    while not self._stop.is_set():
                        try:
                            message = ws.recv(timeout=PING_EVERY)
                        except TimeoutError:
                            message = None
                        if message is not None:
                            self.handle(message if isinstance(message, str) else message.decode())
                        if time.monotonic() - last_ping >= PING_EVERY:
                            ws.send(f"PING PING%20{int(time.time() * 1000)}")
                            last_ping = time.monotonic()
            except Exception as exc:  # the board must outlive a flaky socket
                with self._lock:
                    self.state = "reconnecting"
                    self.error = str(exc)[:200]
                self._stop.wait(RECONNECT_WAIT)
        with self._lock:
            self.state = "closed"

"""Your own calls, layered on the computed board — read from marks.toml.

The engine ranks by projection and value over replacement; that's the floor.
What it can't know is this week's news and your read of the room. This file
is where that judgment lives, as data the board wears as chips and a plan
rail. Change a call, rebuild the page: that's the whole update loop.

Four kinds of mark, in precedence order when a name carries more than one:

    sleeper   hurt today, but the reduced projection still clears replacement —
              a late pick plus the IR slot buys the healthy version
    alert     news the projections have not priced (global, every league)
    fade      priced fine, still don't take him at that price
    target    take him at or slightly ahead of his price

Plus `reprice`, which scales a projection before VOR is computed (a torn
Achilles is not a QUESTIONABLE tag), and per-league `principles` and `script`
text the plan rail shows verbatim.

    # marks.toml
    [alerts]
    "Some Player" = "Exempt list, no timetable — the board still prices him RB16."

    [reprice."Some Player"]
    factor = 0.65
    verdict = "AVOID"

    [leagues.123456]
    principles = ["Ten teams means replacement is fat — RB/WR through round 8."]
    script = [["1", 6, "Best RB standing; tiebreak to the WR."]]
    [leagues.123456.targets]
    "Other Player" = "R1 anchor — the VOR gap to the next RB is the round"
    [leagues.123456.fades]
    [leagues.123456.sleepers]

Every function takes an optional path so tests and the demo can point at a
fixture; the default is marks.toml in the working directory, and no file at
all is fine — the board then wears no chips.
"""

from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path

from . import config

VERDICTS = ("AVOID", "WAIT", "DISCOUNT", "LATE ONLY", "RISK-PRICE", "STASH 160+")
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


@lru_cache(maxsize=8)
def _load(path: str | None) -> dict:
    p = Path(path) if path else config.workdir() / "marks.toml"
    if not p.exists():
        return {}
    return tomllib.loads(p.read_text())


def reprice(path: Path | None = None) -> dict[str, dict]:
    """Name -> {factor, verdict}. Applied to projections before VOR."""
    out = {}
    for name, spec in _load(str(path) if path else None).get("reprice", {}).items():
        out[name] = {"factor": float(spec["factor"]), "verdict": str(spec.get("verdict", ""))}
    return out


def _league(league_id: str, path: Path | None) -> dict:
    return _load(str(path) if path else None).get("leagues", {}).get(str(league_id), {})


def principles(league_id: str, path: Path | None = None) -> list[str]:
    return list(_league(league_id, path).get("principles", []))


def script(league_id: str, path: Path | None = None) -> list[tuple[str, int, str]]:
    """(round, pick, text) per row of the pick-by-pick script."""
    return [tuple(row) for row in _league(league_id, path).get("script", [])]


def base(name: str) -> str:
    """Generational suffixes stripped, lowercased — ESPN and a marks file disagree
    about Jr./III often enough that exact-match marks silently vanish."""
    parts = name.split()
    while parts and parts[-1].rstrip(".").lower() in SUFFIXES:
        parts.pop()
    return " ".join(parts).lower()


def marks(league_id: str, path: Path | None = None) -> dict[str, tuple[str, str]]:
    """Name -> (mark, why) for one league. Alerts outrank fades outrank targets."""
    doc = _load(str(path) if path else None)
    lg = _league(league_id, path)
    out: dict[str, tuple[str, str]] = {}
    for name, why in lg.get("targets", {}).items():
        out[name] = ("target", why)
    for name, why in lg.get("fades", {}).items():
        out[name] = ("fade", why)
    for name, why in doc.get("alerts", {}).items():
        out[name] = ("alert", why)
    for name, why in lg.get("sleepers", {}).items():
        out[name] = ("slp", why)
    return out

"""Where a draft lives on disk: the working directory you run the CLI from.

Nothing personal is baked into the package. Each league you draft in gets a
folder (or just your repo root) holding:

    .env            ESPN_S2 / ESPN_SWID: the private cookies (never committed)
    leagues.toml    which ESPN leagues to build boards for, and your draft slot
    marks.toml      optional: your own targets / fades / alerts / repricing
    data/raw/       ADP snapshots the availability model reads (`on-the-clock adp`)
    out/            built boards, plans, CSVs

`ON_THE_CLOCK_DIR` overrides the working directory when you'd rather run the
CLI from elsewhere.
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path


def workdir() -> Path:
    return Path(os.environ.get("ON_THE_CLOCK_DIR") or Path.cwd()).resolve()


def raw_dir() -> Path:
    d = workdir() / "data" / "raw"
    d.mkdir(parents=True, exist_ok=True)
    return d


def out_dir() -> Path:
    d = workdir() / "out"
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_env(path: Path | None = None) -> None:
    """Read KEY=value lines into the environment without overriding what's set."""
    path = path or workdir() / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def cookies() -> dict[str, str]:
    """ESPN's two private cookies. Both are required for any league that isn't public."""
    load_env()
    return {
        "espn_s2": os.environ.get("ESPN_S2", ""),
        "SWID": os.environ.get("ESPN_SWID", ""),
    }


def require_cookies() -> dict[str, str]:
    c = cookies()
    if not c["espn_s2"] or not c["SWID"]:
        raise SystemExit(
            "ESPN_S2 / ESPN_SWID missing: put them in .env (see .env.example). "
            "Both come from your browser's cookies on fantasy.espn.com."
        )
    return c


def leagues(path: Path | None = None) -> list[dict]:
    """The leagues to build, from leagues.toml:

        [[league]]
        id = "123456"     # ESPN league id, from the URL
        slot = 6          # your draft slot; omit until the order is published

    Only the slot is typed: team count, rounds, and which team is yours are
    read from ESPN, so a typo can't silently skew a pick ladder. A league with
    no slot gets a slot picker in the tracker, which locks itself in the moment
    ESPN reveals the order (or from the live picks themselves).
    """
    path = path or workdir() / "leagues.toml"
    if not path.exists():
        raise SystemExit(f"{path} not found: copy leagues.example.toml and fill in your league id")
    doc = tomllib.loads(path.read_text())
    out = []
    for lg in doc.get("league", []):
        if "id" not in lg:
            raise SystemExit("every [[league]] needs an id")
        out.append({"id": str(lg["id"]), "slot": lg.get("slot")})
    if not out:
        raise SystemExit(f"{path} has no [[league]] entries")
    return out

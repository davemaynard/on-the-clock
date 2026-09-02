"""Snapshot live ADP from Fantasy Football Calculator into a dated board.

FFC publishes ADP computed from real mock drafts, free and unauthenticated, with
sample size and per-player standard deviation attached. That last field is the
useful one: stdev is the market telling you how much it disagrees with itself
about a player, which is exactly where a prepared drafter gets to wait.

    on-the-clock adp --format ppr

Writes a dated raw snapshot to data/raw/ (so a board can be diffed week over week)
and a readable board to out/.

**There is no team-count option on purpose.** The endpoint accepts a `teams`
parameter and echoes it back in the response metadata, but returns byte-identical
player data for 10, 12, and 14 — same 7,112 drafts, same ADPs to the decimal.
Passing it produced a file labelled "10-team ADP" that was really the same pooled
board, which is worse than not having one. If you need team-count-specific ADP,
it has to come from somewhere else.

**Tiers here are market tiers, not talent tiers.** A tier breaks where the gap to
the next player is unusually large *for that depth of the board*, measured against
the local median gap at that position. That says "drafters clearly separate these
two," nothing more. Real tiers need projections; these tell you where the cliffs
in the *room* are, which is what you actually draft against.
"""

from __future__ import annotations

import argparse
import json
import statistics
from datetime import date

import httpx

from . import config

API = "https://fantasyfootballcalculator.com/api/v1/adp/{fmt}"
FORMATS = {"ppr": "PPR", "half-ppr": "Half-PPR", "standard": "Non-PPR", "2qb": "2QB/Superflex"}


def fetch(fmt: str, year: int) -> dict:
    r = httpx.get(
        API.format(fmt=fmt),
        params={"year": year, "position": "all"},
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("status") != "Success":
        raise SystemExit(f"FFC returned {data.get('status')!r}")
    return data


def tier_breaks(players: list[dict], sensitivity: float, window: int = 5) -> list[int]:
    """Indices where a new tier starts, within one position, ADP-ascending.

    A tier breaks where the gap to the next player is unusually large *for that
    depth of the board*. "Unusually" is measured against the median gap among
    nearby players at the same position, because gaps compress at the top (four
    elite RBs inside ten picks) and stretch out late (RB40 to RB41 can be six
    picks and mean nothing). A single global threshold gets one end or the other
    wrong — measured against stdev it produced a 60-player WR tier.
    """
    if len(players) < 3:
        return [0]
    gaps = [players[i]["adp"] - players[i - 1]["adp"] for i in range(1, len(players))]

    breaks = [0]
    for i, gap in enumerate(gaps, start=1):
        local = gaps[max(0, i - 1 - window) : i + window]
        local_median = statistics.median(local) if local else gap
        if gap > max(local_median * sensitivity, 0.5):
            breaks.append(i)
    return breaks


def board(data: dict, sensitivity: float, depth: int) -> str:
    meta = data["meta"]
    players = data["players"]
    for i, p in enumerate(players, 1):
        p["overall"] = i

    by_pos: dict[str, list[dict]] = {}
    for p in players:
        by_pos.setdefault(p["position"], []).append(p)
    for pos_players in by_pos.values():
        pos_players.sort(key=lambda p: p["adp"])
        for i, p in enumerate(pos_players, 1):
            p["pos_rank"] = i

    today = date.today().isoformat()
    out = [
        f"# ADP board — {meta['type']}",
        "",
        f"**Pulled:** {today}  ",
        f"**Source:** Fantasy Football Calculator, {meta['total_drafts']:,} real drafts "
        f"between {meta['start_date']} and {meta['end_date']}. Pooled across league sizes — "
        f"the API's team-count filter is echoed but not applied.  ",
        f"**Tier rule:** new tier where the gap to the next player is unusually large for "
        f"that depth of the board (> {sensitivity}x the local median gap at that position). "
        f"Market tiers, not talent tiers.",
        "",
        "## Overall",
        "",
        "| # | Pick | Player | Pos | Team | Bye | ADP | ± | Range |",
        "|---:|:---|:---|:---|:---|---:|---:|---:|:---|",
    ]
    for p in players[:depth]:
        out.append(
            f"| {p['overall']} | {p['adp_formatted']} | {p['name']} | "
            f"{p['position']}{p['pos_rank']} | {p['team']} | {p.get('bye', '?')} | "
            f"{p['adp']:.1f} | {p.get('stdev', 0):.1f} | {p.get('high', '?')}–{p.get('low', '?')} |"
        )

    out += ["", "## Tiers by position", ""]
    for pos in ("QB", "RB", "WR", "TE"):
        pos_players = [p for p in by_pos.get(pos, []) if p["overall"] <= depth]
        if not pos_players:
            continue
        out += [f"### {pos}", ""]
        starts = tier_breaks(pos_players, sensitivity)
        for tier_no, start in enumerate(starts, 1):
            end = starts[tier_no] if tier_no < len(starts) else len(pos_players)
            group = pos_players[start:end]
            names = ", ".join(f"{p['name']} ({p['adp']:.0f})" for p in group)
            out.append(f"**Tier {tier_no}** — {names}")
            out.append("")

    # Where the room disagrees most: high stdev relative to ADP means the player
    # goes 2-3 rounds apart depending on the draft, so you can often let him fall.
    spread = sorted(
        (p for p in players[:depth] if p["adp"] > 12),
        key=lambda p: -(p.get("stdev", 0) / p["adp"]),
    )[:20]
    out += [
        "## Where the room disagrees most",
        "",
        "High spread relative to ADP — these go multiple rounds apart depending on who's "
        "in the draft. Targets you can usually wait on, or players you must reach for if "
        "you actually want them.",
        "",
        "| Player | Pos | ADP | ± | Range | Spread/ADP |",
        "|:---|:---|---:|---:|:---|---:|",
    ]
    for p in spread:
        out.append(
            f"| {p['name']} | {p['position']}{p['pos_rank']} | {p['adp']:.1f} | "
            f"{p.get('stdev', 0):.1f} | {p.get('high', '?')}–{p.get('low', '?')} | "
            f"{p.get('stdev', 0) / p['adp']:.0%} |"
        )
    out.append("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="on-the-clock adp")
    ap.add_argument("--format", default="ppr", choices=sorted(FORMATS))
    ap.add_argument("--year", type=int, default=date.today().year)
    ap.add_argument("--depth", type=int, default=200, help="How many overall picks to include.")
    ap.add_argument(
        "--tier-sensitivity",
        type=float,
        default=2.0,
        help="Multiple of the local median gap that counts as a tier break. Higher = fewer tiers.",
    )
    args = ap.parse_args(argv)

    data = fetch(args.format, args.year)
    today = date.today().isoformat()

    raw = config.raw_dir() / f"adp-ffc-{args.format}-{today}.json"
    raw.write_text(json.dumps(data, indent=2))

    doc = config.out_dir() / f"adp-{args.format}-{today}.md"
    doc.write_text(board(data, args.tier_sensitivity, args.depth))

    meta = data["meta"]
    print(f"{meta['type']} — {meta['total_drafts']:,} drafts "
          f"({meta['start_date']} to {meta['end_date']}), {len(data['players'])} players")
    print(f"wrote {raw}")
    print(f"wrote {doc}")


if __name__ == "__main__":
    main()

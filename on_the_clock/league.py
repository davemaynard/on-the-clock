"""Pull an ESPN fantasy league's real settings into a readable settings sheet.

ESPN's read API returns the league's actual scoring table, roster slots, and draft
config: which beats retyping a settings screen and beats guessing. Private leagues
need two cookies from a logged-in browser session:

    espn_s2   long URL-encoded blob
    SWID      looks like {AAAA-BBBB-...}, braces included

Get them: espn.com logged in -> DevTools -> Application -> Cookies -> espn.com.
Put them in .env as ESPN_S2 and ESPN_SWID, then:

    on-the-clock league --league-id 123456 --name "Work League"

Stat IDs ESPN doesn't document are printed raw rather than dropped, so nothing in
the scoring table goes missing just because this map is incomplete. Eyeball the
`unmapped` section against the league's scoring page before trusting the output.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import httpx

from . import config

READ_HOST = "https://lm-api-reads.fantasy.espn.com"

# Everything below this line in a league file is hand-written and survives a re-pull.
NOTES_MARKER = "<!-- ===== NOTES BELOW ARE HAND-WRITTEN AND PRESERVED ON RE-PULL ===== -->"

# ESPN lineup slot ids -> readable position.
SLOTS = {
    0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE",
    7: "OP (superflex)", 8: "DT", 9: "DE", 10: "LB", 11: "DL", 12: "CB",
    13: "S", 14: "DB", 15: "DP", 16: "D/ST", 17: "K", 18: "P", 19: "HC",
    20: "BENCH", 21: "IR", 23: "FLEX (RB/WR/TE)", 24: "ER",
}

# ESPN stat ids. Base map from the espn-api project; ids 8/117/198 are not in that
# map and were identified empirically against ESPN's own projected stat lines ,
# statId 8 is passing yards floored into 25-yard chunks (Josh Allen: 3946.4 yards
# -> 8 = 157.0). A league uses either statId 3 (points per passing yard) or
# statId 8 (points per 25 passing yards), not both.
STATS = {
    0: "Passing attempts", 1: "Completions", 2: "Incompletions",
    3: "Passing yards", 4: "Passing TD", 8: "Passing yards (per 25)",
    15: "Passing TD 40+ yds", 16: "Passing TD 50+ yds",
    17: "300-399 yard passing game", 18: "400+ yard passing game",
    19: "Passing 2PT", 20: "Interception thrown", 21: "Completion pct",
    23: "Rushing attempts", 24: "Rushing yards", 25: "Rushing TD",
    26: "Rushing 2PT", 35: "Rushing TD 40+ yds", 36: "Rushing TD 50+ yds",
    37: "100-199 yard rushing game", 38: "200+ yard rushing game",
    39: "Yards per carry",
    41: "Receptions", 42: "Receiving yards", 43: "Receiving TD",
    44: "Receiving 2PT", 45: "Receiving TD 40+ yds", 46: "Receiving TD 50+ yds",
    53: "Receptions", 56: "100-199 yard receiving game",
    57: "200+ yard receiving game", 58: "Targets", 59: "Yards after catch",
    60: "Yards per reception", 62: "2PT conversions",
    63: "Fumble recovered for TD", 64: "Times sacked", 68: "Fumbles",
    72: "Fumble lost", 73: "Turnovers",
    74: "FG made 50+", 75: "FG attempted 50+", 76: "FG missed 50+",
    77: "FG made 40-49", 78: "FG attempted 40-49", 79: "FG missed 40-49",
    80: "FG made 0-39", 81: "FG attempted 0-39", 82: "FG missed 0-39",
    83: "FG made", 84: "FG attempted", 85: "FG missed",
    86: "PAT made", 87: "PAT attempted", 88: "PAT missed",
    89: "DST 0 pts allowed", 90: "DST 1-6 allowed", 91: "DST 7-13 allowed",
    92: "DST 14-17 allowed", 93: "DST blocked kick TD", 94: "DST TD",
    95: "DST interception", 96: "DST fumble recovery", 97: "DST blocked kick",
    98: "DST safety", 99: "DST sack", 101: "Kickoff return TD",
    102: "Punt return TD", 103: "Interception return TD",
    104: "Fumble return TD", 105: "DST/ST TD", 106: "Forced fumbles",
    107: "Assisted tackles", 108: "Solo tackles", 109: "Total tackles",
    113: "Passes defensed", 114: "Kickoff return yards", 115: "Punt return yards",
    120: "DST points allowed", 121: "DST 18-21 allowed", 122: "DST 22-27 allowed",
    123: "DST 28-34 allowed", 124: "DST 35-45 allowed", 125: "DST 45+ allowed",
    127: "DST yards allowed", 128: "DST <100 yards allowed",
    129: "DST 100-199 yards allowed", 130: "DST 200-299 yards allowed",
    131: "DST 300-349 yards allowed", 132: "DST 350-399 yards allowed",
    133: "DST 400-449 yards allowed", 134: "DST 450-499 yards allowed",
    135: "DST 500-549 yards allowed", 136: "DST 550+ yards allowed",
    155: "Team win", 156: "Team loss", 158: "Points scored",
    201: "FG made 60+", 202: "FG attempted 60+", 203: "FG missed 60+",
    205: "DST 2PT return", 206: "DST 2PT return",
}

# pointsOverrides keys are ESPN position ids: a rule can score differently per position.
POSITIONS = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST"}

def fetch(league_id: str, year: int, s2: str | None, swid: str | None) -> dict:
    url = f"{READ_HOST}/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}"
    cookies = {}
    if s2 and swid:
        cookies = {"espn_s2": s2, "SWID": swid}
    r = httpx.get(
        url,
        params=[("view", v) for v in ("mSettings", "mTeam", "mDraftDetail")],
        cookies=cookies,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
        follow_redirects=True,
    )
    if r.status_code == 401:
        sys.exit(
            "401 from ESPN: this league is private and the cookies were missing or stale.\n"
            "Set ESPN_S2 and ESPN_SWID in .env (SWID keeps its braces)."
        )
    r.raise_for_status()
    data = r.json()
    return data[0] if isinstance(data, list) else data


def render(league: dict) -> tuple[str, list[str]]:
    settings = league.get("settings", {})
    name = settings.get("name", "Unnamed league")
    size = settings.get("size", "?")
    roster = settings.get("rosterSettings", {})
    scoring = settings.get("scoringSettings", {})
    draft = settings.get("draftSettings", {})

    lines = [f"# {name}", ""]
    lines += [
        f"- **Platform:** ESPN (league {league.get('id')}, {league.get('seasonId')})",
        f"- **Teams:** {size}",
        f"- **Draft:** {draft.get('type', '?')}: order type {draft.get('orderType', '?')}"
        f"{', ' + str(draft.get('date')) if draft.get('date') else ''}",
        f"- **Keepers:** {'yes' if draft.get('keeperCount') else 'none'}"
        f"{' (' + str(draft.get('keeperCount')) + ')' if draft.get('keeperCount') else ''}",
        "- **PPR-ish check:** see Receptions row below",
        "",
        "## Roster",
        "",
        "| Slot | Count |",
        "|---|---|",
    ]
    counts = roster.get("lineupSlotCounts", {})
    starters = 0
    for slot_id, count in sorted(counts.items(), key=lambda kv: int(kv[0])):
        if not count:
            continue
        label = SLOTS.get(int(slot_id), f"slot {slot_id}")
        lines.append(f"| {label} | {count} |")
        if label not in {"BENCH", "IR"}:
            starters += count
    lines += ["", f"**Starters:** {starters}", ""]
    lines += ["## Scoring", "", "| Event | Points |", "|---|---|"]

    acq = settings.get("acquisitionSettings", {})
    trade = settings.get("tradeSettings", {})

    unmapped: list[str] = []
    for item in scoring.get("scoringItems", []):
        stat_id = item.get("statId")
        pts = item.get("points")
        label = STATS.get(stat_id)
        overrides = item.get("pointsOverrides") or {}
        if label is None:
            label = f"statId {stat_id}"
            unmapped.append(f"statId {stat_id} = {pts}")
        if overrides:
            # A base of 0 with a single position override means the rule only
            # applies to that position: render it that way instead of "0.0".
            parts = [f"{POSITIONS.get(int(k), k)} {v}" for k, v in sorted(overrides.items())]
            shown = ", ".join(parts) if not pts else f"{pts} (" + ", ".join(parts) + ")"
        else:
            shown = str(pts)
        lines.append(f"| {label} | {shown} |")

    lines += [
        "",
        "## Waivers / trades",
        "",
        f"- **Waiver process days:** {acq.get('waiverProcessDays', '?')}",
        f"- **FAAB budget:** {acq.get('acquisitionBudget', 'n/a')}",
        f"- **Trade deadline:** {trade.get('deadlineDate', '?')}",
        "",
        NOTES_MARKER,
        "",
        "## What the scoring actually rewards",
        "",
        "<One line on where this league diverges from generic PPR: that's the whole edge.>",
        "",
        "## The other managers",
        "",
        "<Who reaches, who hoards RBs, who never trades. The edge no ranking contains.>",
        "",
    ]
    return "\n".join(lines), unmapped


def merge_notes(body: str, existing: Path) -> str:
    """Keep everything a human wrote below the marker; regenerate only the settings.

    Settings get re-pulled all season (scoring can change, rosters can change), so
    the generated half has to be overwritable. The analysis underneath it is the
    part with actual work in it and must survive that.
    """
    if not existing.exists():
        return body
    prior = existing.read_text()
    if NOTES_MARKER not in prior or NOTES_MARKER not in body:
        return body
    return body.split(NOTES_MARKER)[0] + NOTES_MARKER + prior.split(NOTES_MARKER, 1)[1]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="on-the-clock league")
    ap.add_argument("--league-id", required=True)
    ap.add_argument("--year", type=int, default=date.today().year)
    ap.add_argument("--name", help="Filename slug. Defaults to the league's own name.")
    ap.add_argument("--raw", action="store_true", help="Also dump the raw JSON to data/raw/.")
    args = ap.parse_args(argv)

    c = config.cookies()
    league = fetch(args.league_id, args.year, c["espn_s2"] or None, c["SWID"] or None)
    body, unmapped = render(league)

    slug = (args.name or league.get("settings", {}).get("name", args.league_id)).lower()
    slug = "".join(c if c.isalnum() else "-" for c in slug).strip("-")
    out = config.workdir() / "leagues" / f"{slug}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(merge_notes(body, out))
    print(f"wrote {out}")

    if args.raw:
        raw = config.raw_dir() / f"espn-{args.league_id}-{args.year}.json"
        raw.write_text(json.dumps(league, indent=2))
        print(f"wrote {raw}")

    if unmapped:
        print(f"\n{len(unmapped)} scoring rows had stat ids this script doesn't name:")
        for u in unmapped:
            print(f"  {u}")
        print("Check these against the league's scoring page before trusting the file.")


if __name__ == "__main__":
    main()

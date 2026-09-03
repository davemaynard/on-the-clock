"""Build a league-specific draft board from ESPN's own league-scored projections.

Consensus rankings are scored for a generic league. Yours are not. ESPN computes
each player's projected season total **through your league's actual scoring
rules**: verified: recomputing every rule against ESPN's projected stat lines
reproduces their published total to the cent for both leagues. So the projections
already price in whatever your league does differently, including per-game
yardage bonuses and long-TD bonuses.

What this adds on top is **value over replacement**, which is the number that
actually decides a draft. 320 projected points means nothing on its own; it means
something relative to the player you could have had at that position instead. The
replacement line comes from a greedy fill of your league's real starting lineup
(team count x each slot, flex included), not a rule of thumb.

    on-the-clock board --league-id <espn league id>

Then the last section is the point of the exercise: where value-over-replacement
disagrees with what the room is actually doing. Those are the targets and fades.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from datetime import date

import httpx

from . import config

HOST = "https://lm-api-reads.fantasy.espn.com"

POS = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST"}
# Flex-family lineup slots: ESPN slot id -> which positions can fill it. Slot 7
# (OP/superflex) is the one that changes a draft: it puts QBs in flex demand,
# which moves QB replacement level by a full tier. Missing a slot id here used to
# silently delete starters from the replacement math; now any non-zero lineup
# slot that isn't in SLOT_POS, FLEX_SLOTS, or IGNORED_SLOTS raises.
FLEX_SLOTS = {3: ("RB", "WR"), 5: ("WR", "TE"), 7: ("QB", "RB", "WR", "TE"),
              23: ("RB", "WR", "TE")}
FLEX_LABELS = {3: "RB/WR", 5: "WR/TE", 7: "OP", 23: "FLEX"}
IGNORED_SLOTS = frozenset({20, 21, 24})  # bench, IR, ER: not starters
# Kicker and defense are computed for replacement level but kept off the board.
# Their projected spread is narrower than their own week-to-week variance, so a
# few points of "value over replacement" is noise wearing a number: VOR ranks
# K1 alongside a mid-round RB, which is how you end up drafting a kicker in the
# fifth round. Stream them; take them in the last two rounds.
STREAMED = frozenset({"K", "DST"})

# ESPN marks most of the top of the board QUESTIONABLE through camp: 17 of the top
# 20 projected players carried it in late August one year. Flagging that is noise pretending
# to be a warning, so only genuinely actionable designations get a marker.
ALARMING = frozenset({"OUT", "DOUBTFUL", "INJURY_RESERVE", "SUSPENSION"})
SLOT_POS = {0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "DST", 17: "K"}
PRO_TEAMS = {
    0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA",
    16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI",
    23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR",
    30: "JAX", 33: "BAL", 34: "HOU",
}


def my_team_id(league: dict) -> int | None:
    """your own teamId in this league, from the SWID cookie vs. team owners."""
    swid = os.environ.get("ESPN_SWID", "").upper()
    for t in league.get("teams", []):
        if any(str(o).upper() == swid for o in t.get("owners", [])):
            return t["id"]
    return None


def norm(name: str) -> str:
    """Match ESPN names to other sources: strip accents, suffixes, punctuation."""
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    n = re.sub(r"\b(Jr|Sr|II|III|IV|V)\b\.?", "", n, flags=re.I)
    n = re.sub(r"[^a-z ]", "", n.lower())
    return " ".join(n.split())


def fetch_league(league_id: str, year: int, cookies: dict) -> dict:
    # mTeam rides along so callers can find your own teamId by matching the
    # SWID cookie against team owners, instead of typing it per league.
    r = httpx.get(
        f"{HOST}/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}",
        params=[("view", "mSettings"), ("view", "mTeam")],
        cookies=cookies,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def fetch_players(
    league_id: str, year: int, cookies: dict, limit: int, rank_type: str = "PPR"
) -> list[dict]:
    filt = {
        "players": {
            "limit": limit,
            "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": rank_type},
        }
    }
    r = httpx.get(
        f"{HOST}/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}",
        params={"view": "kona_player_info"},
        cookies=cookies,
        headers={"User-Agent": "Mozilla/5.0", "x-fantasy-filter": json.dumps(filt)},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()["players"]


def extract(entries: list[dict], year: int, rank_type: str = "PPR") -> list[dict]:
    out = []
    for e in entries:
        pl = e["player"]
        proj = next(
            (
                s
                for s in pl.get("stats", [])
                # statSourceId 1 = projection, split 0 = full season
                if s.get("id") == f"10{year}" and s.get("statSourceId") == 1
            ),
            None,
        )
        if not proj or not proj.get("appliedTotal"):
            continue
        pos = POS.get(pl.get("defaultPositionId"))
        if not pos:
            continue
        ranks = pl.get("draftRanksByRankType") or {}
        out.append(
            {
                # ESPN's own player id: the join key for live draft picks,
                # which arrive as playerIds and nothing else.
                "espn_id": pl["id"],
                "name": pl["fullName"],
                "key": norm(pl["fullName"]),
                "pos": pos,
                "team": PRO_TEAMS.get(pl.get("proTeamId"), "?"),
                "proj": round(proj["appliedTotal"], 1),
                "espn_adp": (pl.get("ownership") or {}).get("averageDraftPosition"),
                "espn_rank": (ranks.get(rank_type) or ranks.get("PPR") or {}).get("rank"),
                "status": pl.get("injuryStatus", "ACTIVE"),
            }
        )
    return out


def flex_families(slots: dict) -> list[tuple[int, tuple[str, ...], int]]:
    """Non-zero flex-family lineup slots as (slot_id, eligible_positions, count).

    Sorted most-constrained-first (fewest eligible positions), so a greedy fill
    commits the narrow slots (RB/WR) before the wide ones (OP): the wide slot
    can always absorb whatever the narrow one couldn't.
    """
    fams = [
        (int(sid), FLEX_SLOTS[int(sid)], count)
        for sid, count in slots.items()
        if count and int(sid) in FLEX_SLOTS
    ]
    return sorted(fams, key=lambda f: len(f[1]))


def replacement_levels(players: list[dict], settings: dict) -> tuple[dict[str, float], dict]:
    """Greedy-fill every team's starting lineup; the last starter sets the line.

    A rule of thumb ("RB24 is replacement in a 12-team league") ignores that flex
    spots are won by whichever position is actually deepest at that point in the
    board. Filling the real lineup answers it instead of assuming it. Flex-family
    slots (FLEX, OP/superflex, RB/WR, WR/TE) each allocate to whichever eligible
    position projects highest among what's left.
    """
    teams = settings["size"]
    slots = settings["rosterSettings"]["lineupSlotCounts"]

    required: dict[str, int] = {}
    for slot_id, count in slots.items():
        sid = int(slot_id)
        pos = SLOT_POS.get(sid)
        if pos and count:
            required[pos] = required.get(pos, 0) + count * teams
        elif count and sid not in FLEX_SLOTS and sid not in IGNORED_SLOTS:
            raise SystemExit(
                f"lineup slot id {sid} (x{count}) is not in SLOT_POS/FLEX_SLOTS: "
                "add it before trusting any replacement level from this league"
            )
    families = flex_families(slots)
    flex_total = sum(count for _, _, count in families) * teams

    pool: dict[str, list[dict]] = {}
    for p in players:
        pool.setdefault(p["pos"], []).append(p)
    for group in pool.values():
        group.sort(key=lambda p: -p["proj"])

    taken = {pos: min(n, len(pool.get(pos, []))) for pos, n in required.items()}

    # Each flex spot goes to whoever projects highest among its eligible positions.
    for _, eligible, count in families:
        for _ in range(count * teams):
            best_pos, best_proj = None, float("-inf")
            for pos in eligible:
                idx = taken.get(pos, 0)
                group = pool.get(pos, [])
                if idx < len(group) and group[idx]["proj"] > best_proj:
                    best_pos, best_proj = pos, group[idx]["proj"]
            if best_pos is None:
                break
            taken[best_pos] = taken.get(best_pos, 0) + 1

    levels: dict[str, float] = {}
    for pos, idx in taken.items():
        group = pool.get(pos, [])
        if not group:
            continue
        levels[pos] = group[min(idx, len(group) - 1)]["proj"]
    return levels, {
        "required": required,
        "flex": flex_total,
        "families": [
            {"slot": sid, "label": FLEX_LABELS[sid], "eligible": list(elig), "count": count}
            for sid, elig, count in families
        ],
        "starters_taken": taken,
    }


def final_rows(
    players: list[dict],
    settings: dict,
    marks: dict[str, tuple[str, str]],
    reprice: dict[str, dict],
    raw: dict[str, dict] | None = None,
) -> tuple[list[dict], dict[str, float], dict]:
    """The ONE row list every artifact renders: board HTML, CSV, research doc.

    News repricing happens first: `adj_proj = proj x factor` for names in
    `reprice` (suffix-tolerant join), with `proj` kept untouched for
    struck-through display and the verdict string carried on the row.

    Replacement levels stay on the *raw* projections: the news is a fact about
    one player, not about the position. Repricing the starter pool would move
    the line under every healthy player at that position too (Kittle falling
    out of the TE12 line lifts every other TE ~11 VOR against the RB/WR board),
    which is a cross-position ranking change nobody asked for. So the levels
    match the pre-news board, and only the repriced player's own VOR moves.
    VOR follows for every position including K/DST (replacement_levels already
    yields the (teams+1)th K/DST unit).

    Rows come back skill-sorted by -vor, then K by -vor, then DST by -vor,
    then a stub row (`stub: 1`, numbers None) for every `marks` name with no
    projected player: so the marks layer can never reference a ghost.
    `raw` is an optional norm(name) -> {espn_id, pos, team, status} index from
    the raw fetch, to flesh out stubs ESPN carries without a projection.

    Takes marks/reprice as plain data so this stays import-free of marks
    and testable against a synthetic pool.
    """
    re_base = {norm(k): v for k, v in reprice.items()}
    for p in players:
        key = p.get("key") or norm(p["name"])
        rp = reprice.get(p["name"]) or re_base.get(key)
        p["adj_proj"] = round(p["proj"] * rp["factor"], 1) if rp else p["proj"]
        p["verdict"] = rp["verdict"] if rp else ""

    levels, detail = replacement_levels(players, settings)
    for p in players:
        p["vor"] = round(p["adj_proj"] - levels.get(p["pos"], 0), 1)

    mk_base = {norm(k): v for k, v in marks.items()}
    names = {p["name"] for p in players}
    keys = set()
    for p in players:
        key = p.get("key") or norm(p["name"])
        keys.add(key)
        m = marks.get(p["name"]) or mk_base.get(key)
        p["mark"], p["why"] = m if m else ("", "")

    stubs = []
    for name, (mark, why) in marks.items():
        if name in names or norm(name) in keys:
            continue
        e = (raw or {}).get(norm(name), {})
        stubs.append({
            "espn_id": e.get("espn_id"), "name": name, "key": norm(name),
            "pos": e.get("pos", ""), "team": e.get("team", ""),
            "proj": None, "adj_proj": None, "vor": None,
            "espn_adp": None, "espn_rank": None,
            "status": e.get("status", "ACTIVE"),
            "mark": mark, "why": why, "verdict": "", "pos_rank": "", "stub": 1,
        })

    rows = sorted((p for p in players if p["pos"] not in STREAMED), key=lambda p: -p["vor"])
    by_pos: dict[str, int] = {}
    for p in rows:
        by_pos[p["pos"]] = by_pos.get(p["pos"], 0) + 1
        p["pos_rank"] = by_pos[p["pos"]]
    for pos in ("K", "DST"):
        group = sorted((p for p in players if p["pos"] == pos), key=lambda p: -p["vor"])
        for i, p in enumerate(group, 1):
            p["pos_rank"] = i
        rows += group
    return rows + stubs, levels, detail


def is_superflex(settings: dict) -> bool:
    """True when any non-zero flex-family slot can hold a QB (OP/superflex)."""
    slots = settings["rosterSettings"]["lineupSlotCounts"]
    return any("QB" in elig for _, elig, _ in flex_families(slots))


def adp_format(settings: dict) -> str:
    """Which FFC ADP market matches this league: superflex rooms draft QBs a
    full tier earlier, so comparing them against 1-QB ADP calls every QB a reach."""
    return "2qb" if is_superflex(settings) else "ppr"


def load_consensus(fmt: str = "ppr") -> dict[str, float]:
    """Latest FFC snapshot for the given format, keyed by normalized name.

    Pooled across league sizes: FFC's team-count filter is echoed in the response
    metadata but does not change the data, so there is no 10-team board to compare
    a 10-team league against. Read the ADP columns as "what the wider market does,"
    and the ESPN ADP column as "what this room is more likely to do."
    """
    snaps = sorted(config.raw_dir().glob(f"adp-ffc-{fmt}-*.json"))
    if not snaps:
        return {}
    data = json.loads(snaps[-1].read_text())
    return {norm(p["name"]): p["adp"] for p in data["players"]}


def build(
    league: dict, players: list[dict], league_id: str, depth: int,
    marks: dict[str, tuple[str, str]], reprice: dict[str, dict],
) -> str:
    settings = league["settings"]
    name = settings.get("name", league_id)
    teams = settings["size"]
    rows, levels, detail = final_rows(players, settings, marks, reprice)
    fmt = adp_format(settings)
    consensus = load_consensus(fmt)

    ranked = [p for p in rows if not p.get("stub") and p["pos"] not in STREAMED]
    for i, p in enumerate(ranked, 1):
        p["vor_rank"] = i
        p["adp"] = consensus.get(p["key"])

    slot_counts = settings["rosterSettings"]["lineupSlotCounts"]
    slot_desc = ", ".join(
        f"{v}x{SLOT_POS.get(int(k)) or FLEX_LABELS.get(int(k)) or f'slot{k}'}"
        for k, v in sorted(slot_counts.items(), key=lambda kv: int(kv[0]))
        if v and int(k) not in IGNORED_SLOTS
    )

    out = [
        f"# Draft board: {name}",
        "",
        f"**League:** ESPN {league_id} · {teams} teams · {slot_desc}  ",
        f"**Built:** {date.today().isoformat()}  ",
        "**Projections:** ESPN's own, scored through this league's rules "
        "(verified: recomputing the rules against ESPN's projected stat lines "
        "reproduces their published totals to the cent).  ",
        f"**Consensus ADP:** latest Fantasy Football Calculator "
        f"{'2QB/superflex' if fmt == '2qb' else 'PPR'} snapshot in `data/raw/`.",
        "",
        "Only `Out` / `Doubtful` designations are marked. ESPN had 17 of the top 20 projected "
        "players listed Questionable on the day this was built: in camp that status is "
        "noise, and flagging it would bury the two designations that matter.",
        "",
        "## Replacement level",
        "",
        "Where each position stops mattering, from a greedy fill of every team's real "
        f"starting lineup ({detail['flex']} flex spots allocated to whoever projects highest):",
        "",
        "| Pos | Starters rostered | Replacement player's projection |",
        "|:---|---:|---:|",
    ]
    for pos in ("QB", "RB", "WR", "TE", "DST", "K"):
        if pos in levels:
            out.append(f"| {pos} | {detail['starters_taken'].get(pos, 0)} | {levels[pos]:.1f} |")

    out += [
        "",
        "",
        "**K and DST are deliberately absent below.** Their replacement lines are computed "
        "above, but their projected spread is narrower than their own week-to-week variance, "
        "so ranking them by value over replacement puts a kicker in the fifth round. Stream "
        "them, take them with your last two picks.",
        "",
        "## The board, by value over replacement",
        "",
        "`Adj` is the projection after news repricing (marks.toml `reprice`); `VOR` is the "
        "*adjusted* projection minus the replacement player at that position. "
        "`ADP` is consensus. `Gap` is how many picks of value you gain (+) or give up (−) "
        "taking him at his ADP.",
        "",
        "| VOR# | Player | Pos | Team | Proj | Adj | VOR | ESPN ADP | Consensus ADP | Gap |",
        "|---:|:---|:---|:---|---:|---:|---:|---:|---:|---:|",
    ]
    for p in ranked[:depth]:
        adp = p["adp"]
        gap = f"{adp - p['vor_rank']:+.0f}" if adp else ", "
        espn_adp = f"{p['espn_adp']:.1f}" if p["espn_adp"] else ", "
        flag = f" **[{p['status'].title()}]**" if p["status"] in ALARMING else ""
        out.append(
            f"| {p['vor_rank']} | {p['name']}{flag} | {p['pos']}{p['pos_rank']} | {p['team']} | "
            f"{p['proj']:.0f} | {p['adj_proj']:.0f} | {p['vor']:.0f} | {espn_adp} | "
            f"{adp:.1f} | {gap} |" if adp else
            f"| {p['vor_rank']} | {p['name']}{flag} | {p['pos']}{p['pos_rank']} | {p['team']} | "
            f"{p['proj']:.0f} | {p['adj_proj']:.0f} | {p['vor']:.0f} | {espn_adp} |: |: |"
        )

    # Only players who are actually worth a pick can be mispriced. Below
    # replacement, "VOR rank" is meaningless: those players are interchangeable
    # with the waiver wire, so a late ADP flatters them into looking like value.
    # Ranking them produced a target list of sub-replacement tight ends.
    # IR/ER spots aren't drafted: counting them stretched the "priced" window.
    draftable_through = teams * sum(
        v for k, v in settings["rosterSettings"]["lineupSlotCounts"].items()
        if int(k) not in (21, 24)
    )
    priced = [
        p for p in ranked
        if p["adp"] and p["vor"] > 0 and p["adp"] <= draftable_through
    ]
    targets = sorted(priced, key=lambda p: -(p["adp"] - p["vor_rank"]))[:20]
    fades = sorted(priced, key=lambda p: (p["adp"] - p["vor_rank"]))[:20]

    def table(rows: list[dict], title: str, blurb: str) -> list[str]:
        lines = [f"## {title}", "", blurb, "",
                 "| Player | Pos | Proj | VOR | VOR# | Consensus ADP | Gap |",
                 "|:---|:---|---:|---:|---:|---:|---:|"]
        for p in rows:
            lines.append(
                f"| {p['name']} | {p['pos']}{p['pos_rank']} | {p['proj']:.0f} | {p['vor']:.0f} | "
                f"{p['vor_rank']} | {p['adp']:.1f} | {p['adp'] - p['vor_rank']:+.0f} |"
            )
        lines.append("")
        return lines

    out += [""]
    out += table(
        targets,
        "Targets: worth more to this league than the room is paying",
        "Their value in *this* scoring, at *this* team count, outruns where they actually go. "
        "The bigger the gap, the longer you can wait and still get them. "
        "Players below replacement level are excluded: a late ADP doesn't make a "
        "replacement-level player a bargain.",
    )
    out += table(
        fades,
        "Fades: the room pays more than this league says they're worth",
        "Not bad players. Players whose price already exceeds their edge over replacement here. "
        "Let someone else take them.",
    )
    return "\n".join(out)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="on-the-clock board")
    ap.add_argument("--league-id", required=True)
    ap.add_argument("--year", type=int, default=date.today().year)
    ap.add_argument("--limit", type=int, default=500, help="Players to pull from ESPN.")
    ap.add_argument("--depth", type=int, default=175, help="Rows in the main board.")
    args = ap.parse_args(argv)

    cookies = config.require_cookies()

    league = fetch_league(args.league_id, args.year, cookies)
    rank_type = "SUPERFLEX" if is_superflex(league["settings"]) else "PPR"
    entries = fetch_players(args.league_id, args.year, cookies, args.limit, rank_type)
    players = extract(entries, args.year, rank_type)
    print(f"{len(players)} players with projections")

    from . import marks as st  # here, not module-level: final_rows stays import-free of marks

    body = build(league, players, args.league_id, args.depth,
                 st.marks(args.league_id), st.reprice())
    slug = "".join(
        c if c.isalnum() else "-" for c in league["settings"].get("name", args.league_id).lower()
    ).strip("-")
    out = config.out_dir() / f"board-{slug}-{date.today().isoformat()}.md"
    out.write_text(body)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()

"""Generate the draft board: one page, every league in leagues.toml, read on a phone.

Everything here is derived, not typed, so this can be re-run the morning of a draft
and be current. The page answers the three questions you actually get asked by the
clock: who can still reach me, what does waiting cost, and who is hurt.

    on-the-clock build --out out/board.html
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from . import board, config, images, marks, plan

POS_SHOWN = ("RB", "WR", "TE", "QB")
DEPTH = 200  # players carried into the tracker board


def gather(cfg: dict, year: int, cookies: dict) -> dict:
    """Fetch one league from ESPN and assemble its board."""
    league = board.fetch_league(cfg["id"], year, cookies)
    rank_type = "SUPERFLEX" if board.is_superflex(league["settings"]) else "PPR"
    entries = board.fetch_players(cfg["id"], year, cookies, 500, rank_type)
    return assemble(cfg, league, entries, year)


def assemble(cfg: dict, league: dict, entries: list[dict], year: int,
             spread: dict | None = None, marks_path: Path | None = None) -> dict:
    """Everything the page needs for one league, from already-fetched ESPN data.
    `spread` (name -> (adp, stdev)) defaults to the latest FFC snapshot in
    data/raw/ for the league's format; `marks_path` defaults to marks.toml in
    the working directory. The demo passes its own for both."""
    settings = league["settings"]
    rank_type = "SUPERFLEX" if board.is_superflex(settings) else "PPR"
    players = board.extract(entries, year, rank_type)
    # Names ESPN carries without a projection (Holani-class): keep enough of
    # the raw fetch to give a marked stub its pos/team/espn_id.
    raw: dict[str, dict] = {}
    for e in entries:
        pl = e["player"]
        raw.setdefault(board.norm(pl["fullName"]), {
            "espn_id": pl["id"],
            "pos": board.POS.get(pl.get("defaultPositionId"), ""),
            "team": board.PRO_TEAMS.get(pl.get("proTeamId"), "?"),
            "status": pl.get("injuryStatus", "ACTIVE"),
        })

    # The ONE row list (skill + K/DST + marked stubs, news-repriced, sorted
    # by adjusted VOR) that the HTML board, the payload, and the CSV all
    # render from. Marks are joined inside final_rows, suffix-tolerantly.
    calls = marks.marks(cfg["id"], marks_path)
    all_rows, levels, detail = board.final_rows(
        players, settings, calls, marks.reprice(marks_path), raw
    )
    if spread is None:
        spread = plan.load_adp_spread(board.adp_format(settings))

    teams = settings["size"]
    slot_counts = settings["rosterSettings"]["lineupSlotCounts"]
    # Draft length = every slot that gets drafted; IR/ER don't.
    rounds_total = sum(v for k, v in slot_counts.items() if int(k) not in (21, 24))
    # Your team: typed in leagues.toml (`team = 6`) or, for a private league,
    # found by matching the SWID cookie against team owners.
    team_id = cfg.get("team") or board.my_team_id(league)
    slot = cfg.get("slot")

    for p in all_rows:
        adp, sd = spread.get(p["key"], (None, plan.DEFAULT_STDEV))
        p["consensus"] = adp
        p["centre"] = p["espn_adp"] or adp
        p["sd"] = sd

    ranked = [p for p in all_rows if not p.get("stub") and p["pos"] not in board.STREAMED]

    # Availability math keeps its ADP guard: a player the market never
    # drafts has no curve to model.
    pool = [p for p in ranked if p["centre"]]
    # No slot yet (order unpublished): no pick ladder to precompute. The tracker
    # builds one client-side the moment the slot is known.
    picks = plan.snake_picks(slot, teams, rounds_total) if slot else []
    curve = plan.pick_curve(pool, picks) if picks else {}

    rounds = []
    for i, pick in enumerate(picks[:7]):
        nxt = picks[i + 1] if i + 1 < len(picks) else None
        cands = [
            (plan.p_available(p["centre"], p["sd"], pick), p)
            for p in pool
            if plan.p_available(p["centre"], p["sd"], pick) >= 0.05
        ]
        cands.sort(key=lambda t: -t[1]["vor"])
        top = cands[:7]
        gone = (
            [p for _, p in top if plan.p_available(p["centre"], p["sd"], nxt) < 0.25]
            if nxt else []
        )
        # Which position loses the most between this pick and the next? Comparing
        # drop-offs is the right question: if you'll roster both positions anyway,
        # take the one that erodes faster. But it only yields advice when one
        # position actually wins: a 23-vs-23 tie was rendering as a confident
        # "take QB here", which is a rounding artefact wearing a recommendation.
        drops = []
        if nxt:
            drops = sorted(
                ((pos, curve[pos][pick] - curve[pos][nxt]) for pos in POS_SHOWN if pos in curve),
                key=lambda kv: -kv[1],
            )
        rounds.append(
            {"pick": pick, "round": i + 1, "next": nxt, "cands": top,
             "gone": gone, "drops": drops}
        )

    # Board depth scales with format: DEPTH skill rows as the base, and in a
    # superflex room every QB through QB40 rides along even from outside the
    # slice: backup QBs are real inventory there (~26 went in one 12-team superflex draft).
    # Appending preserves VOR order: anything past DEPTH ranks below the cut.
    # Marked names with a projection below the cut (Holani-class) ride along
    # too: the board must be the superset of the marks layer, whether the
    # name has an ESPN projection or not.
    sflex = board.is_superflex(settings)
    depth = ranked[:DEPTH] + [
        p for p in ranked[DEPTH:]
        if p["mark"] or (sflex and p["pos"] == "QB" and p["pos_rank"] <= 40)
    ]
    # All fetched K/DST with projections, real VOR (replacement = the
    # (teams+1)th unit), no ADP filter and no cap: plus the marked stubs.
    streamers = [p for p in all_rows if not p.get("stub") and p["pos"] in board.STREAMED]
    stubs = [p for p in all_rows if p.get("stub")]
    rows = depth + streamers + stubs

    hurt = [p for p in ranked[:150] if p["status"] in board.ALARMING]
    required = {}
    for slot_id, count in slot_counts.items():
        pos = board.SLOT_POS.get(int(slot_id))
        if pos and count:
            required[pos] = required.get(pos, 0) + count
    return {
        "league_id": cfg["id"],
        "team": team_id,
        # Everything rendered: HTML board, tracker payload, CSV: walks this
        # one list in this one order. Nothing may bypass it.
        "rows": rows,
        "required": required,
        # Flex-family slots per team, most-constrained first (FLEX before OP) ,
        # the tracker fills and prices them in this order.
        "families": detail["families"],
        "flex": sum(f["count"] for f in detail["families"]),
        "name": settings.get("name", cfg["id"]),
        "teams": teams, "slot": slot, "rounds_total": rounds_total,
        "picks": picks, "curve": curve, "rounds": rounds, "hurt": hurt,
        "principles": marks.principles(cfg["id"], marks_path),
        "script": marks.script(cfg["id"], marks_path),
        "windows": marks.windows(cfg["id"], marks_path),
        "levels": levels, "taken": detail["starters_taken"],
        "bench": slot_counts.get("20", 0),
    }


FONTS = (
    "https://fonts.googleapis.com/css2"
    "?family=Barlow+Condensed:wght@500;600;700"
    "&family=IBM+Plex+Mono:wght@400;600"
    "&family=Source+Sans+3:ital,wght@0,400;0,600;1,400"
    "&display=swap"
)

ASSETS = Path(__file__).resolve().parent / "assets"


def asset(name: str) -> str:
    """board.css / board.js: built from web/src by `npm run build`, read at render
    time so a rebuild shows on the next page."""
    return (ASSETS / name).read_text(encoding="utf-8")


def team_codes(data: list[dict]) -> set[str]:
    """Every pro-team abbreviation on any board, for the logo sheet."""
    return {pl["team"] for d in data for pl in d["rows"]}


def logo_css(logos: dict[str, tuple[str, str]]) -> str:
    """One rule per team carrying its mark as a background, keyed by the data-team
    attribute the TeamMark component sets, so 250 rows share 32 images instead of
    inlining the same bytes per row. Dark variants only for the clubs whose mark
    disappears on a dark ground."""
    if not logos:
        return ""
    rule = "[data-team={}]{{background-image:url({})}}"
    light = "".join(rule.format(k, v[0]) for k, v in logos.items())
    dark = "".join(rule.format(k, v[1]) for k, v in logos.items() if v[1])
    css = light
    if dark:
        css += (f'\n:root:not([data-theme="light"]){{@media (prefers-color-scheme:dark){{{dark}}}}}'
                f'\n:root[data-theme="dark"]{{{dark}}}')
    return f"<style>{css}</style>"


def league_payload(d: dict, idx: int) -> dict:
    """One league as the browser side sees it. `players` walks d["rows"] in order, so a
    row's index on the board is its index here. Missing ADP is 999 so the market queue
    sorts those rows last instead of first; `vor` is value over the news-adjusted
    projection; a stub is a marked name with no ESPN projection, so its numbers are
    placeholders."""
    picks_shown = d["picks"][:8]
    return {
        "index": idx,
        "key": d["name"],
        "name": d["name"],
        "leagueId": d["league_id"],
        "team": d["team"],
        "teams": d["teams"],
        "slot": d["slot"],
        "roundsTotal": d["rounds_total"],
        "bench": d["bench"],
        "picks": d["picks"],
        "slots": d["required"],
        "families": d["families"],
        "flex": d["flex"],
        # The lineup as the stat row prints it: starting slots, then the flex families.
        "lineup": [{"count": n, "label": pos} for pos, n in d["required"].items() if n]
        + [{"count": f["count"], "label": f["label"]} for f in d["families"]],
        "principles": d["principles"],
        "script": [{"round": r, "pick": pk, "text": txt} for r, pk, txt in d["script"]],
        "windows": d["windows"],
        # Value of the best player left at each position at each of the first eight
        # picks, from the pre-draft simulation; empty until the slot is known.
        "curve": [
            {"pos": pos, "values": [d["curve"][pos][p] for p in picks_shown]}
            for pos in POS_SHOWN
            if pos in d["curve"]
        ],
        "hurt": [
            {
                "name": p["name"],
                "pos": p["pos"],
                "posRank": p["pos_rank"],
                "status": p["status"],
                "mark": p.get("mark", ""),
            }
            for p in d["hurt"][:8]
        ],
        "players": [
            {
                "name": pl["name"],
                "pos": pl["pos"],
                "posRank": pl["pos_rank"],
                "team": pl["team"],
                "vor": round(pl["vor"], 1) if pl["vor"] is not None else 0,
                "adp": round(pl["centre"], 2) if pl["centre"] else 999,
                "espnId": pl["espn_id"],
                "streamer": pl["pos"] in board.STREAMED,
                "mark": pl.get("mark", ""),
                "why": pl.get("why", ""),
                "proj": pl["proj"],
                "adjProj": pl["adj_proj"],
                "verdict": pl.get("verdict", ""),
                "stub": bool(pl.get("stub")),
                "status": pl["status"],
                "out": pl["status"] in board.ALARMING,
            }
            for pl in d["rows"]
        ],
    }


def _render(data: list[dict], live: bool, logos: dict[str, tuple[str, str]] | None = None) -> str:
    """Assemble the page: the shell, the stylesheet and team-mark sheet, the data the
    components render from, and the components. `live` arms the ESPN poller: only the
    local server can serve that, because a published artifact's CSP cannot reach ESPN
    at all. `logos` is the team -> data URI sheet from images.logos(); None renders
    blank tiles."""
    payload = {
        "live": live,
        "year": date.today().year,
        "leagues": [league_payload(d, i) for i, d in enumerate(data)],
    }
    # A "</" inside the JSON (a name, a why-line) would end the script element early.
    payload_json = json.dumps(payload).replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>On the Clock &middot; draft board</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<style>{asset("board.css")}</style>
{logo_css(logos or {})}
<div id="app"></div>
<noscript><p>On the Clock needs JavaScript: the whole board is drawn in the browser.</p></noscript>
<script>window.ON_THE_CLOCK = {payload_json};</script>
<script>{asset("board.js")}</script>
</html>
"""


def build_page(
    year: int, cookies: dict, live: bool = False, leagues: list[dict] | None = None
) -> tuple[str, list[dict]]:
    """Fetch every configured league and render the one page. `leagues` defaults
    to leagues.toml in the working directory."""
    data = [gather(cfg, year, cookies) for cfg in (leagues or config.leagues())]
    return _render(data, live, images.logos(team_codes(data))), data


def render_page(data: list[dict], live: bool = False,
                logos: dict[str, tuple[str, str]] | None = None) -> str:
    """Render from already-gathered league dicts (the demo and tests use this)."""
    return _render(data, live, logos)


def write_csv(data: list[dict]) -> None:
    """Offline fallback: the same board, importable into Sheets, in case the draft
    room has no usable signal. Walks the identical d["rows"] the HTML renders,
    in the identical order: the CSV must never be a subset of the live product.
    K/DST rows carry real Proj/VOR; stub rows carry the chip and thesis with
    blank numbers."""
    for d in data:
        slug = "".join(c if c.isalnum() else "-" for c in d["name"].lower()).strip("-")
        csv_path = config.out_dir() / f"board-{slug}-{date.today().isoformat()}.csv"
        lines = ["Drafted,Mine,Rank,Player,Pos,Team,Proj,AdjProj,VOR,Verdict,"
                 "ESPN ADP,Status,Chip,Why"]
        for n, pl in enumerate(d["rows"], 1):
            name = pl["name"].replace('"', "'")
            why = pl.get("why", "").replace('"', "'")
            proj = f'{pl["proj"]:.0f}' if pl["proj"] is not None else ""
            adj = f'{pl["adj_proj"]:.0f}' if pl["adj_proj"] is not None else ""
            vor = f'{pl["vor"]:.0f}' if pl["vor"] is not None else ""
            adp = f'{pl["centre"]:.1f}' if pl.get("centre") else ""
            lines.append(
                f',,{n},"{name}",{pl["pos"]}{pl["pos_rank"]},{pl["team"]},'
                f'{proj},{adj},{vor},{pl.get("verdict", "")},{adp},{pl["status"]},'
                f'{pl.get("mark", "")},"{why}"'
            )
        csv_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {csv_path}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="on-the-clock build")
    ap.add_argument("--out", default=None, help="Defaults to out/board.html")
    ap.add_argument("--year", type=int, default=date.today().year)
    ap.add_argument("--csv", action="store_true", help="Also write one CSV per league to out/.")
    args = ap.parse_args(argv)

    cookies = config.require_cookies()
    page, data = build_page(args.year, cookies, live=False)

    out = Path(args.out) if args.out else config.out_dir() / "board.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out}  ({len(page):,} bytes)")
    if args.csv:
        write_csv(data)


if __name__ == "__main__":
    main()

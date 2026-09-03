"""Generate the draft-day cheat sheet — one page, both leagues, read on a phone.

Everything here is derived, not typed, so this can be re-run the morning of a draft
and be current. The page answers the three questions you actually get asked by the
clock: who can still reach me, what does waiting cost, and who is hurt.

    on-the-clock build --out out/board.html
"""

from __future__ import annotations

import argparse
import html
import json
from datetime import date
from pathlib import Path

from . import board as bb
from . import config, images
from . import marks as st
from . import plan as dp

POS_SHOWN = ("RB", "WR", "TE", "QB")
DEPTH = 200  # players carried into the tracker board


def gather(cfg: dict, year: int, cookies: dict) -> dict:
    """Fetch one league from ESPN and assemble its board."""
    league = bb.fetch_league(cfg["id"], year, cookies)
    rank_type = "SUPERFLEX" if bb.is_superflex(league["settings"]) else "PPR"
    entries = bb.fetch_players(cfg["id"], year, cookies, 500, rank_type)
    return assemble(cfg, league, entries, year)


def assemble(cfg: dict, league: dict, entries: list[dict], year: int,
             spread: dict | None = None, marks_path: Path | None = None) -> dict:
    """Everything the page needs for one league, from already-fetched ESPN data.
    `spread` (name -> (adp, stdev)) defaults to the latest FFC snapshot in
    data/raw/ for the league's format; `marks_path` defaults to marks.toml in
    the working directory. The demo passes its own for both."""
    settings = league["settings"]
    rank_type = "SUPERFLEX" if bb.is_superflex(settings) else "PPR"
    players = bb.extract(entries, year, rank_type)
    # Names ESPN carries without a projection (Holani-class): keep enough of
    # the raw fetch to give a marked stub its pos/team/espn_id.
    raw: dict[str, dict] = {}
    for e in entries:
        pl = e["player"]
        raw.setdefault(bb.norm(pl["fullName"]), {
            "espn_id": pl["id"],
            "pos": bb.POS.get(pl.get("defaultPositionId"), ""),
            "team": bb.PRO_TEAMS.get(pl.get("proTeamId"), "?"),
            "status": pl.get("injuryStatus", "ACTIVE"),
        })

    # The ONE row list (skill + K/DST + marked stubs, news-repriced, sorted
    # by adjusted VOR) that the HTML board, the payload, and the CSV all
    # render from. Marks are joined inside final_rows, suffix-tolerantly.
    mk = st.marks(cfg["id"], marks_path)
    all_rows, levels, detail = bb.final_rows(players, settings, mk, st.reprice(marks_path), raw)
    if spread is None:
        spread = dp.load_adp_spread(bb.adp_format(settings))

    teams = settings["size"]
    slot_counts = settings["rosterSettings"]["lineupSlotCounts"]
    # Draft length = every slot that gets drafted; IR/ER don't.
    rounds_total = sum(v for k, v in slot_counts.items() if int(k) not in (21, 24))
    # Your team: typed in leagues.toml (`team = 6`) or, for a private league,
    # found by matching the SWID cookie against team owners.
    team_id = cfg.get("team") or bb.my_team_id(league)
    slot = cfg.get("slot")

    for p in all_rows:
        adp, sd = spread.get(p["key"], (None, dp.DEFAULT_STDEV))
        p["consensus"] = adp
        p["centre"] = p["espn_adp"] or adp
        p["sd"] = sd

    ranked = [p for p in all_rows if not p.get("stub") and p["pos"] not in bb.STREAMED]

    # Availability math keeps its ADP guard — a player the market never
    # drafts has no curve to model.
    pool = [p for p in ranked if p["centre"]]
    # No slot yet (order unpublished): no pick ladder to precompute. The tracker
    # builds one client-side the moment the slot is known.
    picks = dp.snake_picks(slot, teams, rounds_total) if slot else []
    curve = dp.pick_curve(pool, picks) if picks else {}

    rounds = []
    for i, pick in enumerate(picks[:7]):
        nxt = picks[i + 1] if i + 1 < len(picks) else None
        cands = [
            (dp.p_available(p["centre"], p["sd"], pick), p)
            for p in pool
            if dp.p_available(p["centre"], p["sd"], pick) >= 0.05
        ]
        cands.sort(key=lambda t: -t[1]["vor"])
        top = cands[:7]
        gone = (
            [p for _, p in top if dp.p_available(p["centre"], p["sd"], nxt) < 0.25]
            if nxt else []
        )
        # Which position loses the most between this pick and the next? Comparing
        # drop-offs is the right question — if you'll roster both positions anyway,
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
    # slice — backup QBs are real inventory there (~26 went in one 12-team superflex draft).
    # Appending preserves VOR order: anything past DEPTH ranks below the cut.
    # Marked names with a projection below the cut (Holani-class) ride along
    # too — the board must be the superset of the marks layer, whether the
    # name has an ESPN projection or not.
    sflex = bb.is_superflex(settings)
    board = ranked[:DEPTH] + [
        p for p in ranked[DEPTH:]
        if p["mark"] or (sflex and p["pos"] == "QB" and p["pos_rank"] <= 40)
    ]
    # All fetched K/DST with projections, real VOR (replacement = the
    # (teams+1)th unit), no ADP filter and no cap — plus the marked stubs.
    streamers = [p for p in all_rows if not p.get("stub") and p["pos"] in bb.STREAMED]
    stubs = [p for p in all_rows if p.get("stub")]
    rows = board + streamers + stubs

    hurt = [p for p in ranked[:150] if p["status"] in bb.ALARMING]
    required = {}
    for slot_id, count in slot_counts.items():
        pos = bb.SLOT_POS.get(int(slot_id))
        if pos and count:
            required[pos] = required.get(pos, 0) + count
    return {
        "league_id": cfg["id"],
        "team": team_id,
        # Everything rendered — HTML board, tracker payload, CSV — walks this
        # one list in this one order. Nothing may bypass it.
        "rows": rows,
        "required": required,
        # Flex-family slots per team, most-constrained first (FLEX before OP) —
        # the tracker fills and prices them in this order.
        "families": detail["families"],
        "flex": sum(f["count"] for f in detail["families"]),
        "name": settings.get("name", cfg["id"]),
        "teams": teams, "slot": slot, "rounds_total": rounds_total,
        "picks": picks, "curve": curve, "rounds": rounds, "hurt": hurt,
        "principles": st.principles(cfg["id"], marks_path),
        "script": st.script(cfg["id"], marks_path),
        "levels": levels, "taken": detail["starters_taken"],
        "bench": slot_counts.get("20", 0),
    }


def prob_class(p: float) -> str:
    return "hi" if p >= 0.7 else ("mid" if p >= 0.3 else "lo")


def esc(s: object) -> str:
    return html.escape(str(s))


# ESPN's status enums are database values, not labels. "Injury_Reserve" on a
# chip is both plumbing showing through and the widest thing in the row.
STATUS_LABEL = {
    "OUT": "out",
    "DOUBTFUL": "doubtful",
    "INJURY_RESERVE": "IR",
    "SUSPENSION": "susp",
}


def verdict_tag(verdict: str) -> str:
    """The chip form of a verdict. A phone row is ~12rem of shared space for
    name + chip, so "WAIT FOR PRICE" truncated the name to "Micha…". Keep the
    leading word, plus a following number when it carries the instruction
    ("STASH 160+"); the full sentence still shows in the why-line."""
    words = verdict.split()
    if not words:
        return verdict
    tag = words[0]
    # "DO NOT DRAFT" must not abbreviate to "DO"; a number is the instruction
    # ("STASH 160+"), so it comes along too.
    if len(words) > 1 and (len(tag) < 4 or any(c.isdigit() for c in words[1])):
        tag = f"{tag} {words[1]}"
    return tag


def render_league(d: dict, idx: int) -> str:
    picks_head = "".join(f'<th scope="col">{p}</th>' for p in d["picks"][:8])
    rows = []
    for pos in POS_SHOWN:
        if pos not in d["curve"]:
            continue
        vals = [d["curve"][pos][p] for p in d["picks"][:8]]
        top = max(vals) or 1
        cells = "".join(
            f'<td><span class="heat" style="--fill:{max(0.0, min(1.0, v / top)):.3f}">'
            f"{v:.0f}</span></td>"
            for v in vals
        )
        rows.append(f'<tr><th scope="row">{pos}</th>{cells}</tr>')

    board = []
    for i, pl in enumerate(d["rows"]):
        # Status and verdict chips together ("out" + "do not draft") say one
        # thing twice and cost the name its room. The verdict is the stronger
        # of the two — it tells you what to DO — so it stands alone.
        flag = (
            f'<span class="tag tag-out">'
            f'{esc(STATUS_LABEL.get(pl["status"], pl["status"].title()))}</span>'
            if pl["status"] in bb.ALARMING and not pl.get("verdict") else ""
        )
        why = ""
        if pl.get("mark"):
            if pl.get("verdict"):
                # The chip IS the verdict — "avoid", "stash 160+" — not the
                # generic "news" word that only raises the question.
                cls = ("tag-avoid" if pl["verdict"].startswith(("AVOID", "DO NOT"))
                       else "tag-stash")
                tag = verdict_tag(pl["verdict"])
                title = f' title="{esc(pl["verdict"])}"' if tag != pl["verdict"] else ""
                flag += (f'<span class="tag {cls}"{title}>'
                         f'{esc(tag.lower())}</span>')
            else:
                word = "news" if pl["mark"] == "alert" else pl["mark"]
                flag += f'<span class="tag tag-{pl["mark"]}">{word}</span>'
            # The chip carries the verdict, the why-line carries the reason —
            # printing the verdict in both is the "too much metadata" a phone
            # row can't afford. Full wording rides along as the chip's title.
            text = pl["why"]
            why = f'<small class="row-why">{esc(text)}</small>'
        if pl["vor"] is None:
            vor = '<span class="row-vor is-dim">&ndash;</span>'
        else:
            # One number: the current, news-adjusted value. The pre-news figure
            # beside it cost a third of the row's width to say what the chip and
            # the why-line already say; it lives on in the CSV's Proj column.
            vor = f'<span class="row-vor" title="Tap: VOR / fit score">{pl["vor"]:.0f}</span>'
        board.append(
            f'<li class="row{" is-streamer" if pl["pos"] in bb.STREAMED else ""}" data-index="{i}">'
            f'<button class="mine-button" type="button" '
            f'aria-label="Mark {esc(pl["name"])} as mine">+</button>'
            f'<span class="row-name">'
            f'<i class="team-mark team-mark-{esc(pl["team"])}" aria-hidden="true"></i>'
            f'<span class="row-player">{esc(pl["name"])}</span>'
            f"{flag}</span>"
            f'<span class="row-pos">{esc(pl["pos"])}{pl["pos_rank"]}</span>'
            f'<span class="row-team">{esc(pl["team"])}</span>'
            + vor
            + why
            + "</li>"
        )

    hurt = ""
    if d["hurt"]:
        items = "".join(
            f'<li><span class="tag tag-out">{esc(p["status"].title())}</span>'
            + ('<span class="tag tag-slp">slp</span>' if p.get("mark") == "slp" else "")
            + f'{esc(p["name"])} <span class="pos-rank">{esc(p["pos"])}{p["pos_rank"]}</span></li>'
            for p in d["hurt"][:8]
        )
        hurt = f'<section class="hurt"><h3>Actually hurt</h3><ol>{items}</ol></section>'

    chips = "".join(
        f'<button class="pos-filter{" is-on" if q == "ALL" else ""}" type="button" '
        f'data-pos="{q}">{q}</button>'
        for q in ("ALL", "QB", "RB", "WR", "TE", "FLX", "K", "DST")
    )
    plan = ""
    if d["principles"]:
        prins = "".join(f"<li>{esc(x)}</li>" for x in d["principles"])
        script = "".join(
            f'<li><span class="round">R{esc(r)}</span>'
            f'<span class="pick">@{pk}</span><span>{esc(txt)}</span></li>'
            for r, pk, txt in d["script"]
        )
        plan = f"""
  <details class="plan">
    <summary>The plan: thesis and pick script</summary>
    <ul class="plan-principles">{prins}</ul>
    <ol class="plan-script">{script}</ol>
    <p class="plan-note">On the board below: <span class="tag tag-target">target</span>
    take at price &middot; <span class="tag tag-fade">fade</span> not at that price &middot;
    <span class="tag tag-alert">news</span> this week's news, not yet in ESPN's number &middot;
    <span class="tag tag-avoid">avoid</span> repriced, do not draft &middot;
    <span class="tag tag-stash">stash 160+</span> repriced, only at the stated
    price or pick &middot;
    <span class="tag tag-slp">slp</span> hurt sleeper: Out today, still worth a late
    pick for the IR slot. A struck number is the pre-news VOR; the real one follows.
    The one-line why sits under each name.</p>
  </details>"""
    if d["picks"]:
        curve_html = f"""
  <h2>What waiting costs</h2>
  <p class="lede">Value of the best player still on the board, by position, at each of your
  first eight picks, from 4,000 simulated drafts run before the draft starts. Structural,
  not live: a flat row means waiting is free, a steep one means the tier empties before
  your next turn.</p>
  <div class="scroller">
    <table class="curve">
      <thead><tr><th scope="col"><span class="visually-hidden">Position</span></th>
        {picks_head}</tr></thead>
      <tbody>{"".join(rows)}</tbody>
    </table>
  </div>"""
    else:
        curve_html = """
  <h2>What waiting costs</h2>
  <p class="lede">Not built yet: the draft order isn't published. Rebuild this page
  once the slot is known for the full pre-draft table; the live tracker above works
  either way, from the slot you set or the one ESPN reveals.</p>"""
    lineup_desc = " &middot; ".join(
        [f'{n}&times;{pos}' for pos, n in d["required"].items() if n]
        + [f'{f["count"]}&times;{f["label"]}' for f in d["families"]]
    )
    slot_html = ""
    if not d["slot"]:
        opts = "".join(f'<option value="{s}">{s}</option>' for s in range(1, d["teams"] + 1))
        slot_html = f"""
      <label class="slot-picker">Draft slot
        <select class="slot-select" aria-label="Your draft slot">
          <option value="">?</option>{opts}
        </select></label>
      <p class="slot-note">Order isn't out yet. Set it here the moment ESPN reveals it.
      Live sync sets it automatically once the order or first picks appear.</p>"""
    active = " is-active" if idx == 0 else ""
    return f"""
<section class="league{active}" id="league-{idx}" role="tabpanel" aria-labelledby="tab{idx}">
  <div class="column column-rail">
  <p class="stat-row">
    <span><b>{d["teams"]}</b> teams</span>
    <span>slot <b class="slot-stat">{d["slot"] or "TBD"}</b></span>
    <span><b>{d["rounds_total"]}</b> rounds</span>
    <span><b>{d["bench"]}</b> bench</span>
    <span class="lineup-desc">{lineup_desc}</span>
  </p>
  {plan}

  <div class="rail-sticky">
  <div class="assistant">
    <div class="assistant-head">
      <div class="assistant-next">
        <p class="label">Your next pick</p>
        <p class="next-pick">&ndash;</p>
      </div>
      <div class="assistant-status">
        <p class="clock"></p>
        <p class="drafted-count"></p>
        <p class="live-badge" data-state="off"></p>
      </div>
      <button class="assistant-fold" type="button" aria-expanded="true"
        aria-label="Collapse draft assistant"></button>
    </div>
    <p class="advice" aria-live="polite"></p>
    <div class="assistant-body">
      {slot_html}
      <div class="entry">
        <button class="offboard-remove" type="button" aria-label="Remove an unlisted pick"
          title="Undo a +1: removes one off-board pick from the count">&minus;1</button>
        <button class="offboard-add" type="button"
          title="Someone drafted a player who isn't on this board: count the pick
so the clock stays right">
          <b>+1</b> off-board pick</button>
        <span class="offboard-count" aria-live="polite"></span>
        <button class="undo" type="button" disabled>Undo</button>
      </div>
      <p class="label">Best available &middot; chance he lasts to your pick</p>
      <ol class="candidates"></ol>
      <div class="leaders"></div>
    </div>
  </div>

  <h2>Your roster</h2>
  <div class="roster"></div>
  </div>
  </div>

  <div class="column column-board">
  <h2>The board</h2>
  <p class="lede">Tap a player the moment he's taken. Tap again to undo.
  <b>+</b> marks him as yours. Everything above recalculates from what's actually gone,
  which is the part a checklist can't do.</p>
  <div class="tools">
    <input class="search" type="search" placeholder="Search player or team"
           aria-label="Search players">
    <div class="filters">{chips}</div>
    <label class="toggle"><input class="hide-drafted" type="checkbox"> Hide drafted</label>
    <button class="undo" type="button" disabled>Undo</button>
  </div>
  <ol class="board-list">{"".join(board)}</ol>

  <details class="rescue">
    <summary>Save or restore this draft</summary>
    <p class="lede">Picks save to this browser automatically. This code is the backup:
    copy it if you want to move to another device, or if the tab might get evicted.</p>
    <input class="state-code" readonly aria-label="Draft state code">
    <p class="rescue-actions">
      <button class="restore" type="button">Restore from code</button>
      <button class="reset" type="button">Clear all picks</button>
    </p>
    <p class="storage-note" hidden><b>This browser is blocking storage.</b>
    Picks will hold for this session but not survive a reload. Copy the code above
    if you need to be safe.</p>
  </details>
  </div>

  <div class="column column-wide">
  {curve_html}
  {hurt}
  </div>
</section>"""


FONTS = (
    "https://fonts.googleapis.com/css2"
    "?family=Barlow+Condensed:wght@500;600;700"
    "&family=IBM+Plex+Mono:wght@400;600"
    "&family=Source+Sans+3:ital,wght@0,400;0,600;1,400"
    "&display=swap"
)

ASSETS = Path(__file__).resolve().parent / "assets"


def asset(name: str) -> str:
    """board.css / tracker.js: built from web/src by `npm run build`, read at render
    time so a rebuild shows on the next page."""
    return (ASSETS / name).read_text(encoding="utf-8")


def team_codes(data: list[dict]) -> set[str]:
    """Every pro-team abbreviation on any board, for the logo sheet."""
    return {pl["team"] for d in data for pl in d["rows"]}


def logo_css(logos: dict[str, tuple[str, str]]) -> str:
    """One class per team carrying its mark as a background, so 250 rows share
    32 images instead of inlining the same bytes per row. Dark variants only
    for the clubs whose mark disappears on a dark ground."""
    if not logos:
        return ""
    rule = ".team-mark-{}{{background-image:url({})}}"
    light = "".join(rule.format(k, v[0]) for k, v in logos.items())
    dark = "".join(rule.format(k, v[1]) for k, v in logos.items() if v[1])
    css = light
    if dark:
        css += (f'\n:root:not([data-theme="light"]){{@media (prefers-color-scheme:dark){{{dark}}}}}'
                f'\n:root[data-theme="dark"]{{{dark}}}')
    return f"<style>{css}</style>"


def _render(data: list[dict], live: bool, logos: dict[str, tuple[str, str]] | None = None) -> str:
    """Assemble the page. `live` arms the ESPN poller — only the local server can
    serve that, because a published artifact's CSP cannot reach ESPN at all.
    `logos` is the team -> data URI sheet from images.logos(); None renders
    blank tiles."""
    today = date.today()
    tabs = "".join(
        f'<button class="tab" role="tab" id="tab{i}" data-panel="league-{i}" '
        f'aria-selected="{"true" if i == 0 else "false"}" aria-controls="league-{i}">'
        f'{esc(d["name"])}</button>'
        for i, d in enumerate(data)
    )
    panels = "".join(render_league(d, i) for i, d in enumerate(data))
    # The tracker's data contract. One entry per league; `players` walks d["rows"] in
    # order, so a row's index on the board is its index here. Missing ADP is 999 so
    # the market queue sorts those rows last instead of first; `vor` is value over
    # the news-adjusted projection; a stub is a marked name with no ESPN projection,
    # so its numbers are placeholders.
    payload = {
        "live": live,
        "leagues": [
            {
                "index": i,
                "key": d["name"],
                "leagueId": d["league_id"],
                "picks": d["picks"],
                "slots": d["required"],
                "families": d["families"],
                "flex": d["flex"],
                "team": d["team"],
                "teams": d["teams"],
                "slot": d["slot"],
                "roundsTotal": d["rounds_total"],
                "players": [
                    {
                        "name": pl["name"],
                        "pos": pl["pos"],
                        "posRank": pl["pos_rank"],
                        "team": pl["team"],
                        "vor": round(pl["vor"], 1) if pl["vor"] is not None else 0,
                        "adp": round(pl["centre"], 2) if pl["centre"] else 999,
                        "espnId": pl["espn_id"],
                        "streamer": pl["pos"] in bb.STREAMED,
                        "mark": pl.get("mark", ""),
                        "why": pl.get("why", ""),
                        "proj": pl["proj"],
                        "adjProj": pl["adj_proj"],
                        "verdict": pl.get("verdict", ""),
                        "stub": bool(pl.get("stub")),
                        "out": pl["status"] in bb.ALARMING,
                    }
                    for pl in d["rows"]
                ],
            }
            for i, d in enumerate(data)
        ],
    }

    page = f"""<meta charset="utf-8">
<title>On the Clock &middot; draft board</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<style>{asset("board.css")}</style>
{logo_css(logos or {})}
<div class="page">
  <header class="masthead">
    <p class="kicker">{today.year} draft day &middot; built {today.isoformat()}</p>
    <h1>On the Clock</h1>
    <p class="subtitle">{len(data)} leagues, each board built from that league's own scoring and
    real lineup: superflex counts, flex counts, all of it. Tap players off as they go
    and everything recalculates against who is actually gone.</p>
  </header>

  <div class="tabs" role="tablist" aria-label="League">{tabs}</div>
  {panels}

  <footer>
    <p><b>Projections</b> are ESPN's own, run through each league's actual scoring,
    verified by recomputing every rule against ESPN's projected stat lines and matching
    their published totals to the cent. <b>VOR</b> is value over replacement, where
    replacement comes from a greedy fill of that league's real starting lineup.</p>
    <p><b>Before the draft</b>, availability is modelled from each player's ADP.
    <b>During it</b>, the model switches to something stronger: how many players the market
    rates above him are still on the board, against how many picks separate you from your
    turn. Recording picks makes the numbers better, not just tidier.</p>
    <p><b>Kickers and defenses sit at the bottom with real numbers</b>: VOR against
    the first unit left on waivers. Still take them with your last two picks; the numbers
    are there so those picks aren't guesses.
    <b>Only Out and Doubtful are flagged</b>; ESPN had 17 of the top 20 projected players
    marked Questionable in camp.</p>
    <p>{"<b>Live sync is on.</b> Picks entered in ESPN are marked off automatically; "
       "tapping still works and always wins. " if live else ""}Picks are stored in this
    browser only; nothing is shared or uploaded. Rebuild the board the morning of
    each draft; August boards move weekly.</p>
  </footer>
</div>
<script>window.ON_THE_CLOCK = {json.dumps(payload)};</script>
<script>{asset("tracker.js")}</script>
"""
    return page


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
    in the identical order — the CSV must never be a subset of the live product.
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

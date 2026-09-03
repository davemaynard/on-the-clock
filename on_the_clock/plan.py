"""Turn a league board plus a draft slot into a plan for each actual pick.

A ranked board tells you who's good. It doesn't tell you who will still be there
when your turn comes, which is the only question you get to answer on the clock.
This models availability and reports, for every pick you own, who is realistically
reachable and what the position looks like by the time you pick again.

    on-the-clock plan --league-id <espn league id> --slot 6

Team count and round count default to the league's real ESPN settings; pass
--teams/--rounds only to override them.

**Availability model.** A player's ADP is the mean pick he goes at; the spread
around it is roughly normal with the standard deviation the ADP source reports.
So P(still there at pick N) = P(his draw lands after N). ADP is quoted as an
overall pick number, which counts players gone rather than rounds elapsed, so it
compares across league sizes without conversion: the thing that changes with team
count is what a player is *worth*, and VOR already carries that.

The plan is deliberately not a script of who to take. It's the two things that are
hard to do live: knowing who can actually reach you, and seeing the cliff coming
one pick before you're standing on it.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from datetime import date
from pathlib import Path

from . import board as bb
from . import config

DEFAULT_STDEV = 8.0


def snake_picks(slot: int, teams: int, rounds: int) -> list[int]:
    picks = []
    for r in range(1, rounds + 1):
        pos = slot if r % 2 == 1 else teams - slot + 1
        picks.append((r - 1) * teams + pos)
    return picks


def p_available(adp: float, stdev: float, pick: int) -> float:
    """Probability a player is still on the board when `pick` comes up."""
    sd = max(stdev or DEFAULT_STDEV, 1.0)
    z = (pick - adp) / sd
    return 1.0 - 0.5 * (1.0 + math.erf(z / math.sqrt(2)))


def load_adp_spread(
    fmt: str = "ppr", raw_dir: Path | None = None
) -> dict[str, tuple[float, float]]:
    """Name -> (adp, stdev) from the newest FFC snapshot for the given format."""
    snaps = sorted((raw_dir or config.raw_dir()).glob(f"adp-ffc-{fmt}-*.json"))
    if not snaps:
        return {}
    return adp_spread(json.loads(snaps[-1].read_text()))


def adp_spread(data: dict) -> dict[str, tuple[float, float]]:
    """The same map from one FFC payload already in memory."""
    return {bb.norm(p["name"]): (p["adp"], p.get("stdev", DEFAULT_STDEV)) for p in data["players"]}


def pick_curve(pool: list[dict], picks: list[int], sims: int = 4000, seed: int = 7) -> dict:
    """Expected value of the best player left at each position, at each of your picks.

    A per-pick candidate list answers "who might be here". This answers the question
    that actually decides draft structure: *what does waiting cost*. If the best
    available RB is worth about the same at pick 15 as at pick 26, then spending
    pick 15 on a running back buys nothing, and the round-1 debate resolves itself.

    Analytic maxima over correlated availability get ugly, so this simulates: draw
    every player's actual draft slot from a normal around his ADP, see who's left.
    """
    rng = random.Random(seed)
    by_pos: dict[str, list[dict]] = {}
    for p in pool:
        by_pos.setdefault(p["pos"], []).append(p)
    for group in by_pos.values():
        group.sort(key=lambda p: -p["vor"])

    totals = {pos: dict.fromkeys(picks, 0.0) for pos in by_pos}
    for _ in range(sims):
        draw = {id(p): rng.gauss(p["centre"], max(p["sd"], 1.0)) for p in pool}
        for pos, group in by_pos.items():
            for pick in picks:
                for p in group:
                    if draw[id(p)] > pick:
                        totals[pos][pick] += p["vor"]
                        break
    return {pos: {pick: v / sims for pick, v in row.items()} for pos, row in totals.items()}


def render(players: list[dict], picks: list[int], league_name: str, slot: int,
           teams: int, show: int, fmt: str = "ppr") -> str:
    spread = load_adp_spread(fmt)
    for p in players:
        adp, sd = spread.get(p["key"], (None, DEFAULT_STDEV))
        # Prefer ESPN's ADP as the centre: this room drafts on ESPN's board: but
        # take the spread from the consensus source, which is the one that reports it.
        p["centre"] = p["espn_adp"] or adp
        p["sd"] = sd
        p["consensus"] = adp

    pool = [p for p in players if p["pos"] not in bb.STREAMED and p["centre"]]
    pool.sort(key=lambda p: -p["vor"])

    out = [
        f"# Draft plan: {league_name}",
        "",
        f"**Slot {slot} of {teams}**, snake. Built {date.today().isoformat()}.  ",
        "**Your picks:** " + ", ".join(str(n) for n in picks),
        "",
        "Availability is modelled from ESPN's ADP as the centre (this room drafts off "
        "ESPN's board) with the consensus source's standard deviation as the spread. "
        "`P` is the chance a player is still there when you pick.",
        "",
    ]

    curve = pick_curve(pool, picks)
    shown_pos = [p for p in ("RB", "WR", "TE", "QB") if p in curve]
    out += [
        "## What waiting costs",
        "",
        "Expected value of the best player still on the board at each position, at each of "
        "your picks, over 4,000 simulated drafts. Read it as: *if I skip this position now, "
        "what am I giving up by my next pick?* A flat row means waiting is free.",
        "",
        "| Pick | " + " | ".join(shown_pos) + " |",
        "|---:|" + "---:|" * len(shown_pos),
    ]
    for pick in picks:
        cells = " | ".join(f"{curve[pos][pick]:.0f}" for pos in shown_pos)
        out.append(f"| {pick} | {cells} |")
    out.append("")

    prev_best = None
    for i, pick in enumerate(picks):
        nxt = picks[i + 1] if i + 1 < len(picks) else None
        cands = []
        for p in pool:
            prob = p_available(p["centre"], p["sd"], pick)
            if prob >= 0.05:
                cands.append((prob, p))
        cands.sort(key=lambda t: -t[1]["vor"])
        top = cands[:show]
        if not top:
            continue

        # Expected best VOR available here, and what survives to the next pick.
        exp_best = max((prob * p["vor"] for prob, p in cands), default=0)
        out += [f"## Pick {pick}  ·  round {i + 1}", ""]
        if prev_best is not None and exp_best < prev_best * 0.75:
            out.append(
                f"> **Cliff.** Best realistic value here drops sharply from your last pick "
                f"({prev_best:.0f} → {exp_best:.0f} VOR). The tier you wanted is gone by now."
            )
            out.append("")
        prev_best = exp_best

        out += ["| P | Player | Pos | VOR | Proj | ESPN ADP | Consensus |",
                "|---:|:---|:---|---:|---:|---:|---:|"]
        for prob, p in top:
            cons = f"{p['consensus']:.0f}" if p["consensus"] else ", "
            flag = f" **[{p['status'].title()}]**" if p["status"] in bb.ALARMING else ""
            # the news verdict rides along, so the plan reads like the board
            if p.get("verdict"):
                flag += f" **[{p['verdict']}]**"
            out.append(
                f"| {prob:.0%} | {p['name']}{flag} | {p['pos']}{p['pos_rank']} | {p['vor']:.0f} | "
                f"{p['proj']:.0f} | {p['centre']:.1f} | {cons} |"
            )
        out.append("")

        if nxt:
            gone = [
                p for prob, p in cands[:show]
                if p_available(p["centre"], p["sd"], nxt) < 0.25
            ]
            if gone:
                names = ", ".join(f"{p['name']} ({p['pos']}{p['pos_rank']})" for p in gone[:6])
                out.append(
                    f"**Won't survive to {nxt}:** {names}. "
                    f"If you want one of these, this is the pick."
                )
                out.append("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="on-the-clock plan")
    ap.add_argument("--league-id", required=True)
    ap.add_argument("--slot", type=int, required=True)
    ap.add_argument("--teams", type=int, default=None,
                    help="Defaults to the league's real size from ESPN.")
    ap.add_argument("--rounds", type=int, default=None,
                    help="Defaults to the league's real draft length (starters + bench).")
    ap.add_argument("--year", type=int, default=date.today().year)
    ap.add_argument("--show", type=int, default=8, help="Candidates listed per pick.")
    args = ap.parse_args(argv)

    cookies = config.require_cookies()
    league = bb.fetch_league(args.league_id, args.year, cookies)
    settings = league["settings"]
    if args.teams is None:
        args.teams = settings["size"]
    if args.rounds is None:
        args.rounds = sum(
            v for k, v in settings["rosterSettings"]["lineupSlotCounts"].items()
            if int(k) not in (21, 24)  # IR/ER aren't drafted
        )
    fmt = bb.adp_format(settings)
    rank_type = "SUPERFLEX" if bb.is_superflex(settings) else "PPR"
    players = bb.extract(
        bb.fetch_players(args.league_id, args.year, cookies, 500, rank_type),
        args.year, rank_type,
    )

    # Same row list the board and CSV render, so the plan can never quote a VOR
    # or a position rank the live board contradicts. Stubs (marked names with
    # no ESPN projection) and K/DST carry no availability model, so they drop
    # out here: the ranking and the numbers stay the board's.
    from . import marks as st

    rows, _, _ = bb.final_rows(players, settings, st.marks(args.league_id), st.reprice())
    ranked = [p for p in rows if p["pos"] not in bb.STREAMED and not p.get("stub")]

    picks = snake_picks(args.slot, args.teams, args.rounds)
    name = league["settings"].get("name", args.league_id)
    body = render(ranked, picks, name, args.slot, args.teams, args.show, fmt)

    slug = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
    out = config.out_dir() / f"plan-{slug}-slot{args.slot}-{date.today().isoformat()}.md"
    out.write_text(body)
    print(f"picks: {picks}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()

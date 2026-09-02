"""Monte Carlo pick-slot valuation for a snake draft, driven by the league's
real ESPN settings — team count, roster shape, flex families (superflex
included), and draft length all come from the API, not constants.

For each candidate slot 1..teams, simulate the draft thousands of times:
- Opponents pick by ESPN ADP with per-player gaussian noise (stdev from FFC ADP
  data where matchable), constrained by roster need: starters must fill by the
  end, position depth is rationed, and a flex family that can hold a QB makes a
  second QB an early, legal, *expected* pick.
- Our team picks greedy max-VOR off the league-scored board, same constraints.
- Score = projected points of the optimal starting lineup for the league's real
  roster (base slots, then each flex family greedily, narrowest first).
- K/DST are excluded from the simulated rounds — they're the last picks by
  league custom and identical across slots.

Usage:
    on-the-clock sim --league-id <espn league id>
    on-the-clock sim --league-id <espn league id> --sims 3000 --jitter 6

--jitter > 0 re-ranks our own board each sim with gaussian noise on VOR
(imperfect draft-day judgment); lineups are still scored on true projections.
"""

from __future__ import annotations

import argparse
import random
import statistics
from collections import Counter
from datetime import date

from . import board as bb
from . import config
from . import plan as dp

OPP_CHOICE = 12  # opponents sample among this many ADP-eligible players


def load_league(league_id: str, year: int) -> dict:
    cookies = config.require_cookies()
    league = bb.fetch_league(league_id, year, cookies)
    settings = league["settings"]
    rank_type = "SUPERFLEX" if bb.is_superflex(settings) else "PPR"
    players = bb.extract(
        bb.fetch_players(league_id, year, cookies, 400, rank_type), year, rank_type
    )
    levels, detail = bb.replacement_levels(players, settings)
    spread = dp.load_adp_spread(bb.adp_format(settings))

    pool = []
    for p in players:
        if p["pos"] in bb.STREAMED or not p["espn_adp"]:
            continue
        _, sd = spread.get(p["key"], (None, None))
        adp = p["espn_adp"]
        sd = max(1.0, sd) if sd else max(2.5, 0.08 * adp)
        pool.append(
            {
                "name": p["name"],
                "pos": p["pos"],
                "proj": p["proj"],
                "vor": round(p["proj"] - levels.get(p["pos"], 0), 1),
                "adp": adp,
                "sd": sd,
            }
        )

    slot_counts = settings["rosterSettings"]["lineupSlotCounts"]
    required = {}
    for sid, count in slot_counts.items():
        pos = bb.SLOT_POS.get(int(sid))
        if pos and count and pos not in ("K", "DST"):
            required[pos] = required.get(pos, 0) + count
    families = [(tuple(f["eligible"]), f["count"]) for f in detail["families"]]
    draft_rounds = sum(v for k, v in slot_counts.items() if int(k) not in (21, 24))
    stream_rounds = sum(
        v for k, v in slot_counts.items() if bb.SLOT_POS.get(int(k)) in ("K", "DST")
    )
    return {
        "name": settings.get("name", league_id),
        "teams": settings["size"],
        "required": required,               # per-team base starters, skill only
        "families": families,               # narrowest first, from replacement_levels
        "skill_rounds": draft_rounds - stream_rounds,
        "players": pool,
    }


class Roster:
    __slots__ = ("counts", "req", "fams")

    def __init__(self, req: dict, fams: list):
        self.counts = {"QB": 0, "RB": 0, "WR": 0, "TE": 0}
        self.req = req
        self.fams = fams

    def unfilled(self) -> tuple[dict[str, int], int]:
        """(base starter shortfalls per position, unfillable flex-family spots)."""
        c, req = self.counts, self.req
        base = {q: max(0, req.get(q, 0) - c[q]) for q in c}
        surplus = {q: max(0, c[q] - req.get(q, 0)) for q in c}
        fam_need = 0
        for eligible, count in self.fams:
            take = count
            for q in eligible:
                if not take:
                    break
                use = min(take, surplus[q])
                surplus[q] -= use
                take -= use
            fam_need += take
        return base, fam_need

    def allowed(self, rnd: int, rounds_left: int, skill_rounds: int) -> set[str]:
        c, req = self.counts, self.req
        base, fam_need = self.unfilled()
        total_need = sum(base.values()) + fam_need
        # Force starter fills when running out of rounds.
        if rounds_left <= total_need:
            forced = {q for q, n in base.items() if n}
            if fam_need:
                for eligible, _ in self.fams:
                    forced |= set(eligible)
            if forced:
                return forced
        ok = set()
        fam_open = fam_need > 0
        fam_elig = {q for eligible, _ in self.fams for q in eligible}
        for q in ("QB", "TE"):
            cap = req.get(q, 0) + sum(n for e, n in self.fams if q in e) + 1
            if base[q]:
                ok.add(q)
            elif fam_open and q in fam_elig and c[q] < cap - 1:
                ok.add(q)  # e.g. QB2 for a superflex OP slot, any round
            elif c[q] < cap and rnd >= skill_rounds - (2 if q == "QB" else 1):
                ok.add(q)  # pure depth waits for the late rounds
        for q in ("RB", "WR"):
            if c[q] < 7:
                ok.add(q)
        return ok


def lineup_points(picks: list[dict], req: dict, fams: list) -> float:
    by_pos: dict[str, list[float]] = {"QB": [], "RB": [], "WR": [], "TE": []}
    for p in picks:
        by_pos[p["pos"]].append(p["proj"])
    for v in by_pos.values():
        v.sort(reverse=True)
    used = {q: min(req.get(q, 0), len(v)) for q, v in by_pos.items()}
    total = sum(sum(by_pos[q][: used[q]]) for q in by_pos)
    for eligible, count in fams:
        for _ in range(count):
            best_q, best_v = None, float("-inf")
            for q in eligible:
                i = used[q]
                if i < len(by_pos[q]) and by_pos[q][i] > best_v:
                    best_q, best_v = q, by_pos[q][i]
            if best_q is None:
                break
            total += best_v
            used[best_q] += 1
    return total


def simulate(lg: dict, my_slot: int, n_sims: int, seed: int = 17, my_jitter: float = 0.0):
    rng = random.Random(seed * 1000 + my_slot)
    players = lg["players"]
    teams, skill_rounds = lg["teams"], lg["skill_rounds"]
    req, fams = lg["required"], lg["families"]
    n = len(players)
    adp_order = sorted(range(n), key=lambda i: players[i]["adp"])
    base_vor_order = sorted(range(n), key=lambda i: (-players[i]["vor"], -players[i]["proj"]))
    pos = [p["pos"] for p in players]
    adp = [p["adp"] for p in players]
    sd = [p["sd"] for p in players]
    vor = [p["vor"] for p in players]

    scores = []
    first_two = Counter()
    gauss = rng.gauss

    for _ in range(n_sims):
        if my_jitter > 0:
            jit = [vor[i] + gauss(0, my_jitter) for i in range(n)]
            vor_order = sorted(range(n), key=lambda i: -jit[i])
        else:
            vor_order = base_vor_order
        taken = [False] * n
        rosters = [Roster(req, fams) for _ in range(teams)]
        my_players = []
        my_first_two = []

        for rnd in range(1, skill_rounds + 1):
            order = range(1, teams + 1) if rnd % 2 else range(teams, 0, -1)
            for slot in order:
                r = rosters[slot - 1]
                rounds_left = skill_rounds - rnd + 1
                ok = r.allowed(rnd, rounds_left, skill_rounds)

                pick = None
                if slot == my_slot:
                    # greedy max VOR among allowed positions
                    for i in vor_order:
                        if not taken[i] and pos[i] in ok:
                            pick = i
                            break
                else:
                    # noisy-ADP: sample among first OPP_CHOICE eligible by ADP
                    best, best_v = -1, 1e18
                    seen = 0
                    for i in adp_order:
                        if taken[i] or pos[i] not in ok:
                            continue
                        v = gauss(adp[i], sd[i])
                        if v < best_v:
                            best, best_v = i, v
                        seen += 1
                        if seen == OPP_CHOICE:
                            break
                    pick = best if best >= 0 else None
                if pick is None:  # constraint dead-end: take best player, period
                    pick = next(i for i in adp_order if not taken[i])

                taken[pick] = True
                r.counts[pos[pick]] += 1
                if slot == my_slot:
                    my_players.append(players[pick])
                    if rnd <= 2:
                        my_first_two.append(players[pick]["name"])

        scores.append(lineup_points(my_players, req, fams))
        first_two[" + ".join(my_first_two)] += 1

    return scores, first_two


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="on-the-clock sim")
    ap.add_argument("--league-id", required=True)
    ap.add_argument("--year", type=int, default=date.today().year)
    ap.add_argument("--sims", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--jitter", type=float, default=0.0)
    args = ap.parse_args(argv)

    lg = load_league(args.league_id, args.year)
    fams = ", ".join(f"{c}x{'/'.join(e)}" for e, c in lg["families"])
    print(
        f"{lg['name']}: {lg['teams']} teams | lineup {lg['required']} + {fams} | "
        f"{lg['skill_rounds']} skill rounds | {len(lg['players'])} players | "
        f"{args.sims} sims/slot | seed {args.seed} | jitter {args.jitter}\n"
    )

    results = {}
    for slot in range(1, lg["teams"] + 1):
        scores, first_two = simulate(lg, slot, args.sims, seed=args.seed, my_jitter=args.jitter)
        results[slot] = (scores, first_two)
        m = statistics.fmean(scores)
        qs = statistics.quantiles(scores, n=10)
        print(
            f"slot {slot:2d}: mean {m:7.1f}  p10 {qs[0]:7.1f}  "
            f"p50 {statistics.median(scores):7.1f}  p90 {qs[8]:7.1f}"
        )

    print("\n=== Ranked by mean starting-lineup projection ===")
    ranked = sorted(results, key=lambda s: -statistics.fmean(results[s][0]))
    base = statistics.fmean(results[ranked[0]][0])
    for rank, slot in enumerate(ranked, 1):
        scores, first_two = results[slot]
        m = statistics.fmean(scores)
        common = ", ".join(f"{k} ({v * 100 // args.sims}%)" for k, v in first_two.most_common(3))
        print(
            f"{rank:2d}. slot {slot:2d}  mean {m:7.1f}  ({m - base:+6.1f})  "
            f"| top starts: {common}"
        )


if __name__ == "__main__":
    main()

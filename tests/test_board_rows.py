"""final_rows is the one list every artifact renders — pin its contract.

Synthetic pools (same shape as test_replacement) so everything runs offline:
repricing math, K/DST VOR, stub rows for off-pool marked names, and the CSV
walking the identical rows the HTML gets. Marks come from the example file
shipped with the repo, so the example can never drift from what the loader
reads.
"""

from pathlib import Path

from on_the_clock import board as bb
from on_the_clock import config, serve
from on_the_clock import marks as st
from on_the_clock import page as cheatsheet

EXAMPLE = Path(__file__).resolve().parent.parent / "marks.example.toml"


def pool():
    """40 per position, projections descending and unique (QB1=400, QB2=398…).
    Synthetic names normalize to a bare position ("qb"), so name-keyed joins
    in these tests always go through the exact-match path."""
    players = []
    tops = {"QB": 400.0, "RB": 350.0, "WR": 340.0, "TE": 250.0, "K": 150.0, "DST": 140.0}
    for pos, top in tops.items():
        for i in range(40):
            players.append({"pos": pos, "proj": top - 2 * i, "name": f"{pos}{i + 1}"})
    return players


def settings(size, slot_counts):
    return {"size": size, "rosterSettings": {"lineupSlotCounts": slot_counts}}


BLUE_SHAPE = {"0": 1, "2": 2, "4": 2, "6": 1, "23": 2, "16": 1, "17": 1, "20": 6}


def test_example_marks_load_with_every_section():
    rp = st.reprice(EXAMPLE)
    assert rp and all(0 < e["factor"] < 1 and e["verdict"] for e in rp.values())
    assert st.principles("123456", EXAMPLE)
    rnd, pick, text = st.script("123456", EXAMPLE)[0]
    assert (rnd, pick) == ("1", 6) and text
    mk = st.marks("123456", EXAMPLE)
    assert {m for m, _ in mk.values()} == {"alert", "target", "fade", "slp"}
    # alerts are global; a league with no section still wears them
    assert st.marks("999", EXAMPLE) == {k: v for k, v in mk.items() if v[0] == "alert"}


def test_no_marks_file_means_no_chips(tmp_path):
    assert st.marks("123456", tmp_path / "missing.toml") == {}
    assert st.reprice(tmp_path / "missing.toml") == {}


def test_offpool_marked_names_get_stub_rows():
    marks = {"George Holani": ("target", "the seat"), "QB1": ("target", "on-pool")}
    raw = {"george holani": {"espn_id": 4567, "pos": "RB", "team": "SEA",
                             "status": "ACTIVE"}}
    rows, _, _ = bb.final_rows(pool(), settings(10, BLUE_SHAPE), marks, {}, raw)
    stub = next(r for r in rows if r.get("stub"))
    assert stub["name"] == "George Holani"
    assert (stub["pos"], stub["team"], stub["espn_id"]) == ("RB", "SEA", 4567)
    assert stub["proj"] is None and stub["adj_proj"] is None and stub["vor"] is None
    assert stub["mark"] == "target" and stub["why"] == "the seat"
    # the on-pool name joined instead of stubbing, and stubs sort last
    qb1 = next(r for r in rows if r["name"] == "QB1")
    assert qb1["mark"] == "target" and not qb1.get("stub")
    assert rows[-1] is stub


def test_every_marked_name_has_a_row():
    marks = st.marks("123456", EXAMPLE)
    rows, _, _ = bb.final_rows(pool(), settings(10, BLUE_SHAPE), marks, st.reprice(EXAMPLE))
    names = {r["name"] for r in rows}
    for name in marks:
        assert name in names, f"{name} has no board row"


def test_repricing_adjusts_proj_vor_and_sort_order():
    players = pool()
    hurt = next(p for p in players if p["name"] == "RB1")
    hurt["name"] = "Hurt Back"  # realistic name: no norm collision with RB2…
    reprice = {"Hurt Back": {"factor": 0.5, "verdict": "AVOID"}}
    rows, levels, _ = bb.final_rows(players, settings(10, BLUE_SHAPE), {}, reprice)
    row = next(r for r in rows if r["name"] == "Hurt Back")
    assert row["proj"] == 350.0  # original untouched, for struck-through display
    assert row["adj_proj"] == 175.0
    assert row["verdict"] == "AVOID"
    assert row["vor"] == round(175.0 - levels["RB"], 1)  # VOR from adj_proj
    # previously RB1 > RB2; repriced, he sorts below the peer he outranked
    assert rows.index(row) > rows.index(next(r for r in rows if r["name"] == "RB2"))
    peer = next(r for r in rows if r["name"] == "RB2")
    assert peer["adj_proj"] == peer["proj"] and peer["verdict"] == ""


def test_repricing_never_moves_the_replacement_line():
    """News is a fact about one player, not about the position.

    Computing levels off the adjusted pool pushes the starter line down and
    hands every *healthy* player at that position free VOR against the rest of
    the board (a TE1 falling out of the TE12 line once lifted every other TE
    ~11 VOR over the RB/WR field, silently reordering two committed boards).
    Levels stay on the raw projections.
    """
    cfg = settings(10, BLUE_SHAPE)
    _, base, _ = bb.final_rows(pool(), cfg, {}, {})
    players = pool()
    for p in players:  # gut the whole top of the TE board
        if p["pos"] == "TE" and p["proj"] >= 250.0 - 2 * 11:
            p["name"] = f"Hurt {p['name']}"
    reprice = {p["name"]: {"factor": 0.1, "verdict": "AVOID"}
               for p in players if p["name"].startswith("Hurt ")}
    rows, levels, _ = bb.final_rows(players, cfg, {}, reprice)
    assert levels == base
    healthy = next(r for r in rows if r["name"] == "TE13")
    assert healthy["vor"] == round(250.0 - 2 * 12 - base["TE"], 1)


def test_k_dst_rows_score_against_teams_plus_one_unit():
    teams = 10
    rows, levels, _ = bb.final_rows(pool(), settings(teams, BLUE_SHAPE), {}, {})
    assert levels["K"] == 150.0 - 2 * teams  # the (teams+1)th kicker
    assert levels["DST"] == 140.0 - 2 * teams
    k1 = next(r for r in rows if r["name"] == "K1")
    d1 = next(r for r in rows if r["name"] == "DST1")
    assert k1["vor"] == round(150.0 - levels["K"], 1)
    assert d1["vor"] == round(140.0 - levels["DST"], 1)
    assert k1["pos_rank"] == 1 and d1["pos_rank"] == 1
    # ordering contract: all skill rows, then K by -vor, then DST by -vor
    seq = [r["pos"] for r in rows]
    assert seq.index("K") > max(i for i, q in enumerate(seq) if q in ("QB", "RB", "WR", "TE"))
    assert seq.index("DST") > seq.index("K")


def test_csv_walks_the_identical_rows(tmp_path, monkeypatch):
    players = pool()
    dst1 = next(p for p in players if p["name"] == "DST1")
    dst1["espn_id"] = -16008  # ESPN D/ST ids are negative; must survive to the row
    marks = {"George Holani": ("target", "the seat, with commas")}
    rows, _, _ = bb.final_rows(players, settings(10, BLUE_SHAPE), marks, {})
    for r in rows:  # the decoration gather() applies before rendering
        r.setdefault("team", "XX")
        r.setdefault("status", "ACTIVE")
        r.setdefault("centre", None)
        r.setdefault("espn_id", 1)
    assert next(r for r in rows if r["name"] == "DST1")["espn_id"] == -16008

    monkeypatch.setenv("ON_THE_CLOCK_DIR", str(tmp_path))
    cheatsheet.write_csv([{"name": "Testers", "rows": rows}])
    csv = next(config.out_dir().glob("board-testers-*.csv"))
    lines = csv.read_text().splitlines()
    assert lines[0].split(",")[:10] == ["Drafted", "Mine", "Rank", "Player", "Pos",
                                       "Team", "Proj", "AdjProj", "VOR", "Verdict"]
    assert len(lines) == len(rows) + 1  # never a subset: one CSV line per row
    for n, r in enumerate(rows, 1):
        assert f'"{r["name"]}"' in lines[n]  # identical order
    stub_line = lines[1 + rows.index(next(r for r in rows if r.get("stub")))]
    assert ',,,,' in stub_line and "target" in stub_line  # blank numbers, chip kept
    k1_line = lines[1 + rows.index(next(r for r in rows if r["name"] == "K1"))]
    assert ",150,150,20," in k1_line  # K rows print real Proj/AdjProj/VOR


def test_serve_accepts_negative_dst_ids_but_not_placeholders():
    assert serve.is_real_pick(-16008)  # Lions D/ST
    assert serve.is_real_pick(4567)
    assert not serve.is_real_pick(-1)  # live-draft placeholder
    assert not serve.is_real_pick(0)


def test_verdicts_stay_chip_sized():
    """A verdict renders as a chip beside the name on a 390px phone row. Long
    ones ("WAIT FOR PRICE") truncated the player to "Micha…", so the vocabulary
    is closed and short — the nuance belongs in the why-line."""
    for name, rp in st.reprice(EXAMPLE).items():
        v = rp["verdict"]
        assert v in st.VERDICTS, f"{name}: {v!r} is not a canonical verdict"
        assert len(v) <= 10, f"{name}: {v!r} is too long for a chip"


def test_verdict_tag_never_strands_a_leading_word():
    assert cheatsheet.verdict_tag("AVOID") == "AVOID"
    assert cheatsheet.verdict_tag("STASH 160+") == "STASH 160+"
    assert cheatsheet.verdict_tag("DO NOT DRAFT") == "DO NOT"  # not a bare "DO"
    assert cheatsheet.verdict_tag("WAIT FOR PRICE") == "WAIT"

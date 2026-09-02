"""The replacement math is the number every board and plan hangs off — pin it.

These use synthetic pools where every projection is distinct, so the expected
replacement player at each position can be counted by hand.
"""

from on_the_clock import board as bb


def pool():
    """40 per position, projections descending and unique: QB1=400, QB2=398...
    RB1=350, WR1=340, TE1=250 — RBs outproject WRs outproject TEs at equal depth,
    with QBs on top, like real life."""
    players = []
    tops = {"QB": 400.0, "RB": 350.0, "WR": 340.0, "TE": 250.0, "K": 150.0, "DST": 140.0}
    for pos, top in tops.items():
        for i in range(40):
            players.append({"pos": pos, "proj": top - 2 * i, "name": f"{pos}{i + 1}"})
    return players


def settings(size, slot_counts):
    return {"size": size, "rosterSettings": {"lineupSlotCounts": slot_counts}}


def test_standard_two_flex_league():
    """10 teams, 1QB/2RB/2WR/1TE/2FLEX (a common 10-team shape). QB replacement = QB10;
    the 20 flex spots go to the best remaining RB/WR/TE."""
    s = settings(10, {"0": 1, "2": 2, "4": 2, "6": 1, "23": 2, "16": 1, "17": 1, "20": 6})
    levels, detail = bb.replacement_levels(pool(), s)
    taken = detail["starters_taken"]
    assert taken["QB"] == 10
    # Flex fill: TE11 (230) never beats the leftover RBs/WRs, so all 20 flex
    # spots split RB/WR — merged descending, that's RB21-33 (310..286) and
    # WR21-27 (300..288).
    assert taken["TE"] == 10
    assert taken["RB"] == 33 and taken["WR"] == 27
    assert detail["flex"] == 20
    # Replacement = the best player left on waivers, i.e. the first unrostered.
    assert levels["QB"] == 400.0 - 2 * 10  # QB11


def test_superflex_league_puts_qbs_in_flex():
    """12 teams, 1QB/2RB/2WR/1TE/1FLEX/1OP (a 12-team superflex shape). Every OP spot
    is won by a QB — QB replacement falls to QB24."""
    s = settings(
        12, {"0": 1, "2": 2, "4": 2, "6": 1, "7": 1, "23": 1, "16": 1, "17": 1, "20": 7, "21": 1}
    )
    levels, detail = bb.replacement_levels(pool(), s)
    taken = detail["starters_taken"]
    # FLEX fills first (RB25-33, WR25-27); then QB13 (376) beats every leftover
    # RB/WR for all 12 OP spots.
    assert taken["QB"] == 24
    assert levels["QB"] == 400.0 - 2 * 24  # QB25, best left on waivers
    assert detail["flex"] == 24  # 12 FLEX + 12 OP
    labels = {f["label"] for f in detail["families"]}
    assert labels == {"FLEX", "OP"}
    # FLEX (narrower) must be allocated before OP.
    assert [f["label"] for f in detail["families"]] == ["FLEX", "OP"]


def test_unknown_slot_id_refuses_instead_of_dropping_starters():
    s = settings(10, {"0": 1, "9": 1, "20": 5})  # slot 9 = DE, not mapped
    try:
        bb.replacement_levels(pool(), s)
    except SystemExit as e:
        assert "slot id 9" in str(e)
    else:
        raise AssertionError("unmapped starter slot was silently dropped")


def test_superflex_detection():
    sf = settings(12, {"0": 1, "7": 1})
    std = settings(10, {"0": 1, "23": 2})
    assert bb.is_superflex(sf)
    assert not bb.is_superflex(std)
    assert bb.adp_format(sf) == "2qb"
    assert bb.adp_format(std) == "ppr"

"""The demo fixture renders the full page offline, the same path the README
screenshot and the tests use, so a rendering regression fails here first."""

from on_the_clock import demo


def test_demo_assembles_both_leagues():
    data = demo.load()
    names = [d["name"] for d in data]
    assert names == ["Sunday Regulars", "Superflex Invitational"]
    ppr, sflex = data
    assert ppr["teams"] == 12 and ppr["slot"] == 6 and ppr["team"] == 6
    assert sflex["flex"] == 2 and any(f["label"] == "OP" for f in sflex["families"])
    # a superflex room prices QBs into the flex: QB replacement drops by a tier
    assert sflex["levels"]["QB"] < ppr["levels"]["QB"]
    assert len(ppr["picks"]) == ppr["rounds_total"]
    assert ppr["rounds"] and ppr["rounds"][0]["cands"]


def test_demo_page_renders_tracker_payload():
    html = demo.render()
    assert "<h1>On the Clock</h1>" in html
    assert "window.ON_THE_CLOCK = " in html and '"live": false' in html
    assert 'id="tab0"' in html and 'id="tab1"' in html
    # assets are inlined, not linked: the page is one request
    assert "<style>/* Generated from web/src" in html and ":root{" in html
    assert "window.ON_THE_CLOCK" in html.split("<script>")[-1]


def test_demo_marks_reach_the_page():
    """The bundled marks.toml drives the plan rail and the chips, so the demo
    shows every surface the real build has."""
    leagues = demo.load()
    ppr = next(lg for lg in leagues if lg["league_id"] == "100001")
    assert len(ppr["principles"]) == 3
    assert ppr["script"][0][:2] == ("1", 6)
    marked = {r["name"]: r["mark"] for r in ppr["rows"] if r.get("mark")}
    assert marked.get("Chase Brown") == "target"
    assert marked.get("Derrick Henry") == "fade"
    assert marked.get("Isiah Pacheco") == "slp"
    html = demo.render()
    assert '<details class="plan">' in html
    assert "tag-target" in html


def test_demo_logos_come_from_the_fixture():
    """Team marks are read from the bundled logo directory, never the network,
    and only the clubs ESPN gives a dark variant carry one."""
    import re

    from on_the_clock import images, page

    data = demo.load()
    codes = page.team_codes(data)
    logos = images.logos(codes, cache=demo.FIXTURES / "logos", fetch=False)
    assert len(logos) == 32
    assert all(light.startswith("data:image/png;base64,") for light, _ in logos.values())
    assert {k for k, (_, dark) in logos.items() if dark} == {
        "DAL", "DEN", "GB", "LAR", "LV", "MIN", "NYG", "NYJ"}
    html = demo.render()
    assert ".team-mark-DET{background-image:url(data:image/png" in html
    assert '<i class="team-mark team-mark-DET" aria-hidden="true"></i>' in html
    # one rule per team, not one image per row
    assert len(re.findall(r"\.team-mark-[A-Z]+\{background-image", html)) == 32 + 2 * 8
    # an unknown code (stubs, free agents) is a blank tile, not a crash
    assert images.logos({"FA", "?"}, cache=demo.FIXTURES / "logos", fetch=False) == {}


def test_demo_copy_has_no_em_dashes():
    """Colons, commas, and full stops do the work; the em-dash is a tell."""
    import re

    html = demo.render()
    visible = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S)
    assert "\u2014" not in visible and "&mdash;" not in visible

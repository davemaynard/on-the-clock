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


def payload(html: str) -> dict:
    """The data contract the components render from, parsed back out of the page."""
    import json

    start = html.index("window.ON_THE_CLOCK = ") + len("window.ON_THE_CLOCK = ")
    end = html.index(";</script>", start)
    return json.loads(html[start:end].replace("<\\/", "</"))


def test_demo_page_carries_the_shell_and_the_payload():
    """The browser draws the board; the page is the shell, the styles, the data and the
    bundle, inlined so the page is one request."""
    html = demo.render()
    assert "<title>On the Clock &middot; draft board</title>" in html
    assert '<div id="app"></div>' in html
    assert "<style>/* Generated from web/src" in html and ":root{" in html
    data = payload(html)
    assert data["live"] is False and data["year"] >= 2026
    assert [lg["name"] for lg in data["leagues"]] == ["Sunday Regulars", "Superflex Invitational"]
    ppr = data["leagues"][0]
    assert ppr["slot"] == 6 and len(ppr["picks"]) == ppr["roundsTotal"]
    assert ppr["lineup"][0] == {"count": 1, "label": "QB"}
    assert [c["pos"] for c in ppr["curve"]] == ["RB", "WR", "TE", "QB"]
    assert all(len(c["values"]) == 8 for c in ppr["curve"])
    assert len(ppr["players"]) > 200 and ppr["players"][0]["vor"] > ppr["players"][50]["vor"]
    # the bundle is the last script, after the data it reads
    assert "/* Generated from web/src" in html.split("<script>")[-1]


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
    data = payload(demo.render())
    ppr_payload = data["leagues"][0]
    assert len(ppr_payload["principles"]) == 3
    assert ppr_payload["script"][0] == {"round": "1", "pick": 6, "text": ppr["script"][0][2]}
    chips = {p["name"]: p["mark"] for p in ppr_payload["players"] if p["mark"]}
    assert chips["Chase Brown"] == "target" and chips["Isiah Pacheco"] == "slp"


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
    assert "[data-team=DET]{background-image:url(data:image/png" in html
    # one rule per team, not one image per row
    assert len(re.findall(r"\[data-team=[A-Z]+\]\{background-image", html)) == 32 + 2 * 8
    # an unknown code (stubs, free agents) is a blank tile, not a crash
    assert images.logos({"FA", "?"}, cache=demo.FIXTURES / "logos", fetch=False) == {}


def test_demo_copy_has_no_em_dashes():
    """Colons, commas, and full stops do the work; the em-dash is a tell."""
    import re

    html = demo.render()
    visible = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S)
    assert "\u2014" not in visible and "&mdash;" not in visible

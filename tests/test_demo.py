"""The demo fixture renders the full page offline — the same path the README
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
    assert "window.__LEAGUES__" in html and "window.__LIVE__ = false" in html
    assert 'id="tab0"' in html and 'id="tab1"' in html
    # assets are inlined, not linked — the page is one request
    assert "<style>:root{" in html and "const LG = window.__LEAGUES__;" in html


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
    assert "mk-target" in html

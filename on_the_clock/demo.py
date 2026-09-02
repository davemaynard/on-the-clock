"""Render the board from bundled fixture data — no cookies, no network.

    on-the-clock demo            # writes out/demo.html
    on-the-clock demo --serve    # ...and serves it on :8777 (no live sync)

The fixture is two invented leagues (a 12-team PPR room and a 12-team
superflex room, team names made up) over a real late-August snapshot of
ESPN's projections and Fantasy Football Calculator's ADP, so the board looks
and behaves like the real thing. It's also what the tests render.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import config, images, page, plan

FIXTURES = Path(__file__).resolve().parent / "demo"


def load() -> list[dict]:
    """The demo leagues, assembled exactly as `build` would from a live fetch."""
    doc = json.loads((FIXTURES / "leagues.json").read_text())
    adp = {fmt: plan.adp_spread(json.loads((FIXTURES / f"adp-{fmt}.json").read_text()))
           for fmt in ("ppr", "2qb")}
    out = []
    for lg in doc["leagues"]:
        entries = json.loads((FIXTURES / lg["players"]).read_text())
        fmt = "2qb" if page.bb.is_superflex(lg["league"]["settings"]) else "ppr"
        cfg = {"id": lg["league"]["id"], "slot": lg["slot"], "team": lg["team"]}
        out.append(page.assemble(cfg, lg["league"], entries, doc["year"],
                                 spread=adp[fmt], marks_path=FIXTURES / "marks.toml"))
    return out


def render(live: bool = False) -> str:
    data = load()
    # Team marks come from the bundled fixture, never the network.
    logos = images.logos(page.team_codes(data), size=48, cache=FIXTURES / "logos", fetch=False)
    return page.render_page(data, live=live, logos=logos)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="on-the-clock demo")
    ap.add_argument("--out", default=None, help="Defaults to out/demo.html")
    ap.add_argument("--serve", action="store_true", help="Serve it on --port after writing.")
    ap.add_argument("--port", type=int, default=8777)
    args = ap.parse_args(argv)

    html = render()
    out = Path(args.out) if args.out else config.out_dir() / "demo.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out}  ({len(html):,} bytes)")

    if args.serve:
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=str(out.parent), **kw)

            def do_GET(self):  # noqa: N802
                if self.path in ("/", "/index.html"):
                    self.path = f"/{out.name}"
                return super().do_GET()

        httpd = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
        print(f"demo board on http://localhost:{args.port}  (Ctrl-C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

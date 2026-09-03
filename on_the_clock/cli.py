"""`on-the-clock <command>`: one entry point over the engine modules.

    build    fetch every league in leagues.toml and write out/board.html
    serve    the same board as a local draft room, with ESPN's live picks synced in
    plan     cost-of-waiting plan for one league and slot (markdown)
    sim      Monte Carlo value of every draft slot for one league
    board    the value-over-replacement board for one league (markdown)
    adp      snapshot Fantasy Football Calculator ADP into data/raw/
    league   pull a league's settings into a readable sheet
    demo     render the board from bundled fixture data: no cookies, no network
"""

from __future__ import annotations

import sys

COMMANDS = {
    "build": ("page", "the draft board page for every configured league"),
    "serve": ("serve", "local draft room with live ESPN sync"),
    "plan": ("plan", "cost-of-waiting plan for one league + slot"),
    "sim": ("sim", "Monte Carlo pick-slot valuation"),
    "board": ("board", "value-over-replacement board, markdown"),
    "adp": ("adp", "snapshot FFC ADP into data/raw/"),
    "league": ("league", "pull a league's settings sheet"),
    "demo": ("demo", "render the board from fixture data"),
}


def usage() -> str:
    width = max(len(k) for k in COMMANDS)
    rows = "\n".join(f"  {k.ljust(width)}  {v[1]}" for k, v in COMMANDS.items())
    return (f"usage: on-the-clock <command> [options]\n\n{rows}\n\n"
            "Run a command with -h for its options.")


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] in ("-h", "--help"):
        print(usage())
        return
    cmd, rest = argv[0], argv[1:]
    if cmd not in COMMANDS:
        raise SystemExit(f"unknown command {cmd!r}\n\n{usage()}")
    import importlib

    module = importlib.import_module(f"on_the_clock.{COMMANDS[cmd][0]}")
    module.main(rest)


if __name__ == "__main__":
    main()

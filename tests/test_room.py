"""The draft room protocol: the INIT record layout and the frames that follow it."""

import base64
import struct

from on_the_clock import room

LEAGUE = "123456"


def record(team: int, overall: int, player: int, length: int = 45) -> bytes:
    body = room.MARKER + struct.pack(">I", int(LEAGUE)) + struct.pack(">iii", team, overall, player)
    return body + b"\x00" * (length - len(body))


def init_payload(*records: bytes) -> str:
    return base64.b64encode(b"\x00" * 7 + b"".join(records)).decode()


def test_parse_init_reads_made_picks_and_skips_the_rest():
    payload = init_payload(
        # The short records that open the blob share the marker but carry no pick.
        record(123, 0, 0, length=25),
        record(25, 0x40180000, 0, length=25),
        record(1, 1, 4429795),  # Gibbs
        record(7, 2, 4430807),
        record(12, 3, -16034),  # a D/ST: negative id, still a pick
        record(4, 4, -1),  # not drafted yet
        record(11, 5, -1),
    )
    picks = room.parse_init(payload, LEAGUE)
    assert [(p.overall, p.team, p.player) for p in picks] == [
        (1, 1, 4429795),
        (2, 7, 4430807),
        (3, 12, -16034),
    ]


def test_frames_fold_into_the_room_state():
    r = room.Room({"espn_s2": "", "SWID": ""}, 2026, LEAGUE, team_id=5)
    r.handle(f"INIT {init_payload(record(1, 1, 4429795), record(7, 2, -1))}")
    assert r.state == "live"
    r.handle("SELECTED 7 4430807 2 {ABC}")
    r.handle("SELECTING 2 90000")
    snap = r.snapshot()
    assert snap["picks"] == [
        {"overall": 1, "player": 4429795, "team": 1},
        {"overall": 2, "player": 4430807, "team": 7},
    ]
    assert snap["onClock"] == 2
    r.handle("CLOCK 6 85245 11")
    assert r.snapshot()["onClock"] == 11
    r.handle("CHAT 5 {ABC} 1788569649301 hello")  # noise is ignored
    assert len(r.snapshot()["picks"]) == 2


def test_join_url_carries_the_identity_token():
    url = room.join_url(LEAGUE, 5, "{SWID}", "80789999")
    assert url.startswith("wss://fantasydraft.espn.com/game-1/league-123456/JOIN?")
    assert "&5=1:123456:5:{SWID}:80789999&" in url

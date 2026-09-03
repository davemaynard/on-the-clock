import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  advice,
  assess,
  fillLineup,
  marketQueue,
  nextPick,
  openSlots,
  snakePicks,
  survives,
} from "../src/tracker/model.js";
import { decodeState, encodeState } from "../src/tracker/rescue.js";

// A small league: two starting QBs' worth of superflex, and a board of nine.
const league = {
  picks: snakePicks(3, 4, 5),
  slots: { QB: 1, RB: 1, WR: 1, TE: 0, K: 1, DST: 0 },
  families: [{ label: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] }],
  teams: 4,
  roundsTotal: 5,
};
const player = (name, pos, vor, adp, extra = {}) => ({
  name,
  pos,
  posRank: 1,
  team: "DET",
  vor,
  adp,
  espnId: 0,
  streamer: pos === "K" || pos === "DST",
  mark: "",
  why: "",
  stub: false,
  out: false,
  ...extra,
});
const players = [
  player("QB One", "QB", 60, 1),
  player("RB One", "RB", 55, 2),
  player("WR One", "WR", 50, 3),
  player("RB Two", "RB", 30, 4),
  player("WR Two", "WR", 28, 5),
  player("TE One", "TE", 20, 6),
  player("QB Two", "QB", 15, 7),
  player("Kicker", "K", 2, 999),
  player("Hurt WR", "WR", 40, 8, { out: true }),
];
const fresh = () => ({ drafted: new Set(), mine: new Set(), offBoard: 0 });

describe("picks", () => {
  test("a snake draft alternates direction each round", () => {
    assert.deepEqual(snakePicks(3, 4, 5), [3, 6, 11, 14, 19]);
    assert.deepEqual(snakePicks(1, 12, 2), [1, 24]);
  });
  test("the next pick is the first of yours at or after the clock", () => {
    assert.equal(nextPick([3, 6, 11], 0), 3);
    assert.equal(nextPick([3, 6, 11], 3), 6);
    assert.equal(nextPick([3, 6, 11], 11), null);
  });
});

describe("survival", () => {
  test("certain when there are no picks to survive, fading with the horizon", () => {
    assert.equal(survives(0, 0), 1);
    assert.ok(survives(5, 2) > 0.8, "five better players ahead, two picks: probably safe");
    assert.ok(survives(0, 10) < 0.05, "market's top player, ten picks: gone");
    assert.ok(survives(3, 3) > survives(3, 6), "the same queue is less safe further out");
  });
  test("the market queue counts available players ranked above each one", () => {
    const queue = marketQueue(players, new Set([0]));
    assert.equal(queue.get(1), 0, "the best remaining has nobody ahead");
    assert.equal(queue.get(3), 2);
    assert.equal(queue.has(0), false, "drafted players leave the queue");
  });
});

describe("roster need", () => {
  test("open slots come from the lineup minus what you own; flex absorbs surplus", () => {
    const owned = new Set([1, 3]); // two RBs against one RB slot
    const { open, familyOpen } = openSlots(league, players, owned);
    assert.equal(open.RB, 0);
    assert.equal(open.WR, 1);
    assert.deepEqual(familyOpen, [0], "the second RB fills the FLEX");
  });
  test("the assessment ranks by fit and recommends the top three", () => {
    const draft = assess(league, players, fresh());
    assert.equal(draft.next, 3);
    assert.equal(draft.picksAway, 2);
    assert.equal(draft.recommended.size, 3);
    assert.ok(!draft.ranked.includes(8), "an injured player is not a candidate");
    assert.ok(!draft.ranked.includes(7), "a kicker is not a candidate before the endgame");
  });
  test("on the clock once the picks before yours are gone", () => {
    const state = fresh();
    state.drafted.add(0).add(1);
    const draft = assess(league, players, state);
    assert.equal(draft.onClock, true);
    assert.equal(draft.picksAway, 0);
    assert.equal(advice(league, draft).length > 0, true);
  });
  test("off-board picks advance the clock", () => {
    const draft = assess(league, players, { drafted: new Set(), mine: new Set(), offBoard: 2 });
    assert.equal(draft.drafted, 2);
    assert.equal(draft.onClock, true);
  });
  test("without a slot the advice says to set one", () => {
    const noSlot = { ...league, picks: [] };
    assert.match(advice(noSlot, assess(noSlot, players, fresh())), /Set your slot/);
  });
});

describe("advice", () => {
  const withMine = (...indices) => ({
    drafted: new Set(indices),
    mine: new Set(indices),
    offBoard: 0,
  });
  test("names the position whose tier is about to evaporate", () => {
    // A longer draft, so the lineup is not yet forced by the pick count.
    const roomy = { ...league, picks: snakePicks(3, 4, 9) };
    const draft = assess(roomy, players, fresh());
    assert.equal(draft.forced, false);
    assert.match(
      advice(roomy, draft),
      /^Optimize for <b>(QB|RB|WR)<\/b>: waiting past \d+ costs|^Open slot/,
    );
  });
  test("forced: the lineup still has holes and the picks are running out", () => {
    // Three picks left (11, 14, 19 of 19) with QB, RB, WR, K and FLEX all open.
    const state = { drafted: new Set([0, 1, 2, 3, 4, 5, 6]), mine: new Set(), offBoard: 3 };
    const draft = assess(league, players, state);
    assert.equal(draft.forced, true);
    assert.match(advice(league, draft), /^Fill <b>/);
  });
  test("endgame: only the kicker slot is open and one pick remains", () => {
    const state = withMine(0, 1, 2, 3);
    state.drafted.add(4).add(5).add(6);
    state.offBoard = 8; // 15 picks gone; pick 19 is the last
    const draft = assess(league, players, state);
    assert.equal(draft.endgame, true);
    assert.equal(advice(league, draft), "Optimize for <b>K / D/ST</b>: last picks");
    assert.deepEqual(draft.ranked, [7], "only the kicker is a candidate");
    assert.equal(draft.exhausted("WR"), true);
    assert.equal(draft.exhausted("K"), false);
  });
  test("starters filled: shop for depth", () => {
    const flat = { ...league, families: [], picks: snakePicks(3, 4, 6) };
    const draft = assess(flat, players, withMine(0, 1, 2, 7));
    assert.equal(advice(flat, draft), "Optimize for <b>RB/WR depth</b>: starters filled");
  });
  test("starters filled but a flex open: name the family", () => {
    const draft = assess(league, players, withMine(0, 1, 2));
    assert.match(advice(league, draft), /^Optimize for <b>FLEX<\/b>: 1 open/);
  });
});

describe("lineup", () => {
  test("starters fill greedily by value; the rest is the bench", () => {
    const { slots, bench } = fillLineup(league, players, new Set([0, 1, 3, 4, 7]));
    assert.deepEqual(
      slots.map((s) => [s.label, s.player?.name ?? null]),
      [
        ["QB", "QB One"],
        ["RB", "RB One"],
        ["WR", "WR Two"],
        ["FLEX", "RB Two"],
        ["K", "Kicker"],
      ],
    );
    assert.deepEqual(bench, []);
  });
});

describe("rescue code", () => {
  test("round-trips the state and survives garbage", () => {
    const state = { drafted: new Set([0, 3, 40, 41]), mine: new Set([3]), offBoard: 2 };
    const back = decodeState(encodeState(state));
    assert.deepEqual([...back.drafted], [0, 3, 40, 41]);
    assert.deepEqual([...back.mine], [3]);
    assert.equal(back.offBoard, 2);
    assert.deepEqual(decodeState("!!~??~"), { drafted: new Set(), mine: new Set(), offBoard: 0 });
  });
});

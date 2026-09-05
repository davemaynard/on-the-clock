import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DraftState } from "../src/model/model.ts";
import {
  advice,
  adviceText,
  assess,
  fillLineup,
  marketQueue,
  nextPick,
  openSlots,
  snakePicks,
  survives,
} from "../src/model/model.ts";
import { decodeState, encodeState } from "../src/model/rescue.ts";
import type { FlexFamily, Player, Position } from "../src/model/types.ts";

// A small league: two starting QBs' worth of superflex, and a board of nine.
const flex: FlexFamily = { label: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] };
const league = {
  picks: snakePicks(3, 4, 5),
  slots: { QB: 1, RB: 1, WR: 1, TE: 0, K: 1, DST: 0 },
  families: [flex],
  teams: 4,
  roundsTotal: 5,
};
const player = (
  name: string,
  pos: Position,
  vor: number,
  adp: number,
  extra: Partial<Player> = {},
): Player => ({
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
  proj: vor + 100,
  adjProj: vor + 100,
  verdict: "",
  stub: false,
  status: "ACTIVE",
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
const fresh = (): DraftState => ({ drafted: new Set(), mine: new Set(), offBoard: 0 });

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
    const stub = player("Ghost", "WR", 0, 999, { stub: true });
    const draft = assess(league, [...players, stub], fresh());
    assert.ok(!draft.ranked.includes(players.length), "a stub row is never a candidate");
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
    assert.notEqual(advice(league, draft), null);
  });
  test("off-board picks advance the clock", () => {
    const draft = assess(league, players, { drafted: new Set(), mine: new Set(), offBoard: 2 });
    assert.equal(draft.drafted, 2);
    assert.equal(draft.onClock, true);
  });
  test("without a slot the advice says to set one", () => {
    const noSlot = { ...league, picks: [] };
    assert.match(adviceText(advice(noSlot, assess(noSlot, players, fresh()))), /Set your slot/);
  });
});

describe("advice", () => {
  const withMine = (...indices: number[]): DraftState => ({
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
      adviceText(advice(roomy, draft)),
      /^Optimize for (QB|RB|WR): waiting past \d+ costs|^Open slot/,
    );
  });
  test("forced: the lineup still has holes and the picks are running out", () => {
    // Three picks left (11, 14, 19 of 19) with QB, RB, WR, K and FLEX all open.
    const state: DraftState = {
      drafted: new Set([0, 1, 2, 3, 4, 5, 6]),
      mine: new Set(),
      offBoard: 3,
    };
    const draft = assess(league, players, state);
    assert.equal(draft.forced, true);
    assert.equal(advice(league, draft)?.before, "Fill ");
  });
  test("endgame: only the kicker slot is open and one pick remains", () => {
    const state = withMine(0, 1, 2, 3);
    state.drafted.add(4).add(5).add(6);
    state.offBoard = 8; // 15 picks gone; pick 19 is the last
    const draft = assess(league, players, state);
    assert.equal(draft.endgame, true);
    assert.equal(adviceText(advice(league, draft)), "Optimize for K / D/ST: last picks");
    assert.deepEqual(draft.ranked, [7], "only the kicker is a candidate");
    assert.equal(draft.exhausted("WR"), true);
    assert.equal(draft.exhausted("K"), false);
  });
  test("starters filled: shop for depth", () => {
    const flat = { ...league, families: [], picks: snakePicks(3, 4, 6) };
    const draft = assess(flat, players, withMine(0, 1, 2, 7));
    assert.deepEqual(advice(flat, draft), {
      before: "Optimize for ",
      focus: "RB/WR depth",
      after: ": starters filled",
    });
  });
  test("starters filled but a flex open: name the family", () => {
    const draft = assess(league, players, withMine(0, 1, 2));
    assert.match(adviceText(advice(league, draft)), /^Optimize for FLEX: 1 open/);
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

describe("windows and surplus", () => {
  // A longer draft so the lineup is never forced by the pick count.
  const roomy = { ...league, picks: snakePicks(3, 4, 9) };
  test("a closed window keeps an open slot out of the need bonus and the advice", () => {
    const windowed = { ...roomy, windows: { QB: 20 } };
    const plain = assess(roomy, players, fresh());
    const draft = assess(windowed, players, fresh());
    assert.ok(draft.fit(0) < plain.fit(0), "the QB loses his need bonus before pick 20");
    assert.doesNotMatch(adviceText(advice(windowed, draft)), /Optimize for QB/);
  });
  test("a second onesie is bench, not a starter: marked down instead of earning flex", () => {
    const state: DraftState = { drafted: new Set([5]), mine: new Set([5]), offBoard: 0 };
    const withTE = { ...roomy, slots: { ...roomy.slots, TE: 1 } };
    const draft = assess(withTE, players, state);
    const te = player("TE Two", "TE", 20, 9);
    const wr = player("WR Three", "WR", 20, 10);
    const more = [...players, te, wr];
    const again = assess(withTE, more, state);
    assert.ok(
      again.fit(more.indexOf(te)) < again.fit(more.indexOf(wr)),
      "same VOR, the WR fits better",
    );
    assert.equal(draft.open.TE, 0);
  });
  test("a third onesie has no path to the lineup and sits below any RB or WR", () => {
    const withTE = { ...roomy, slots: { ...roomy.slots, TE: 1 } };
    const backup = player("TE Two", "TE", 20, 9);
    const third = player("TE Three", "TE", 25, 10);
    const bench = player("WR Bench", "WR", -30, 11);
    const more = [...players, backup, third, bench];
    const state: DraftState = { drafted: new Set([5, 9]), mine: new Set([5, 9]), offBoard: 0 };
    const draft = assess(withTE, more, state);
    assert.ok(
      draft.fit(more.indexOf(third)) < draft.fit(more.indexOf(bench)),
      "a -30 WR beats a +25 third TE",
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type FeedLeague, mergeFeed } from "../src/model/live.ts";
import type { DraftState } from "../src/model/model.ts";
import type { Player } from "../src/model/types.ts";

const player = (espnId: number, name: string): Player => ({
  name,
  espnId,
  pos: "RB",
  posRank: 1,
  team: "DET",
  vor: 10,
  adp: 10,
  streamer: false,
  mark: "",
  why: "",
  proj: 100,
  adjProj: 100,
  verdict: "",
  stub: false,
  status: "ACTIVE",
  out: false,
});
const players = [player(11, "A"), player(22, "B"), player(33, "C")];
const league: FeedLeague = { team: 6, teams: 12, slot: 3 };
const fresh = (): DraftState => ({ drafted: new Set(), mine: new Set(), offBoard: 0 });

describe("live sync merges ESPN's picks without ever un-marking a tap", () => {
  test("picks mark players drafted, your team's picks mark them mine", () => {
    const state = { ...fresh(), drafted: new Set([2]) };
    const merged = mergeFeed(
      {
        ok: true,
        inProgress: true,
        picks: [
          { player: 11, team: 6, overall: 3 },
          { player: 22, team: 7, overall: 4 },
        ],
      },
      { league, players, state },
    );
    assert.deepEqual(merged.drafted, [0, 1], "only what the tap didn't already mark");
    assert.deepEqual(merged.mine, [0]);
    assert.deepEqual(merged.badge, { state: "live", text: "2 picks from ESPN" });
    assert.equal(merged.slot, null, "a known slot is never touched");
  });

  test("off-board picks are counted; a finished draft is flagged", () => {
    const merged = mergeFeed(
      { ok: true, inProgress: false, drafted: true, picks: [{ player: 999, team: 1, overall: 1 }] },
      { league, players, state: fresh() },
    );
    assert.equal(merged.offBoard, 1);
    assert.equal(merged.done, true);
    assert.deepEqual(merged.badge, { state: "synced", text: "1 pick from ESPN · 1 off-board" });
  });

  test("a published draft order sets the slot when none is known", () => {
    const merged = mergeFeed(
      { ok: true, inProgress: false, orderFinal: true, pickOrder: [2, 6, 9], picks: [] },
      { league: { ...league, slot: 0 }, players, state: fresh() },
    );
    assert.equal(merged.slot, 2);
  });

  test("your own first-round pick reveals the slot too", () => {
    const merged = mergeFeed(
      { ok: true, inProgress: true, picks: [{ player: 11, team: 6, overall: 5 }] },
      { league: { ...league, slot: 0 }, players, state: fresh() },
    );
    assert.equal(merged.slot, 5);
  });

  test("the badge stays silent until ESPN has picks", () => {
    const merged = mergeFeed(
      { ok: true, inProgress: false, picks: [] },
      { league, players, state: fresh() },
    );
    assert.deepEqual(merged.badge, { state: "off", text: "" });
  });
});

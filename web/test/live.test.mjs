import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { startLiveSync } from "../src/tracker/live.js";

const players = [
  { espnId: 11, name: "A" },
  { espnId: 22, name: "B" },
  { espnId: 33, name: "C" },
];

/** Run one poll against a canned ESPN response and return what the tracker did. */
async function pollOnce(draft, { league, state }) {
  const calls = { changes: 0, badges: [], slots: [] };
  globalThis.fetch = async () => ({ json: async () => draft });
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // one poll is enough for a test
  try {
    startLiveSync({
      league,
      players,
      state,
      onChange: () => calls.changes++,
      onBadge: (badgeState, text) => calls.badges.push([badgeState, text]),
      setSlot: (slot) => calls.slots.push(slot),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.setInterval = realSetInterval;
  }
  return calls;
}

describe("live sync merges ESPN's picks without ever un-marking a tap", () => {
  test("picks mark players drafted, your team's picks mark them mine", async () => {
    const state = { drafted: new Set([2]), mine: new Set(), offBoard: 0 };
    const league = { leagueId: "1", team: 6, teams: 12, slot: 3, picks: [] };
    const calls = await pollOnce(
      {
        ok: true,
        inProgress: true,
        picks: [
          { player: 11, team: 6, overall: 3 },
          { player: 22, team: 7, overall: 4 },
        ],
      },
      { league, state },
    );
    assert.deepEqual([...state.drafted].sort(), [0, 1, 2], "the earlier tap on C survives");
    assert.deepEqual([...state.mine], [0]);
    assert.equal(calls.changes, 1);
    assert.deepEqual(calls.badges.at(-1), ["live", "2 picks from ESPN"]);
  });

  test("off-board picks advance the clock; a finished draft is flagged", async () => {
    const state = { drafted: new Set(), mine: new Set(), offBoard: 0 };
    const league = { leagueId: "1", team: 6, teams: 12, slot: 3, picks: [] };
    await pollOnce(
      { ok: true, inProgress: false, drafted: true, picks: [{ player: 999, team: 1, overall: 1 }] },
      { league, state },
    );
    assert.equal(league.feedOffBoard, 1);
    assert.equal(league.done, true);
  });

  test("a published draft order sets the slot once", async () => {
    const state = { drafted: new Set(), mine: new Set(), offBoard: 0 };
    const league = { leagueId: "1", team: 6, teams: 12, slot: 0, picks: [] };
    const calls = await pollOnce(
      { ok: true, inProgress: false, orderFinal: true, pickOrder: [2, 6, 9], picks: [] },
      { league, state },
    );
    assert.deepEqual(calls.slots, [2]);
  });

  test("the badge stays silent until ESPN has picks", async () => {
    const state = { drafted: new Set(), mine: new Set(), offBoard: 0 };
    const league = { leagueId: "1", team: 6, teams: 12, slot: 3, picks: [] };
    const calls = await pollOnce({ ok: true, inProgress: false, picks: [] }, { league, state });
    assert.deepEqual(calls.badges, [["off", ""]]);
  });
});

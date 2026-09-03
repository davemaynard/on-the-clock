// Live sync from ESPN, served only by the local draft room. Additive by design: a pick
// ESPN reports gets marked, but nothing here ever un-marks a player. You may know a
// pick before ESPN does, especially in an offline league where ESPN only knows what
// the commissioner has typed, so a tap must never be overwritten by a feed that is
// behind. The merge is a pure function of one poll; the hook that applies it lives with
// the components.

export const POLL_MS = 5000;

/** The badge when the feed has nothing to say. */
export const BADGE_OFF = { state: "off", text: "" };

/** Ask the local server for one league's draft. Null when it has none to give. */
export async function fetchDraft(leagueId) {
  const response = await fetch(`/api/draft?league=${leagueId}`, { cache: "no-store" });
  const draft = await response.json();
  return draft.ok ? draft : null;
}

/**
 * What one ESPN poll changes, without applying it.
 *
 * `league` carries `team`, `teams`, the current `slot` (0 when unknown) and the feed's
 * own `feedOffBoard` tally; `state` the drafted and mine index sets. Returns the row
 * indices newly drafted and newly yours, the off-board pick count ESPN reports, whether
 * the draft is over, a slot to lock in (or null), and the badge to show.
 */
export function mergeFeed(draft, { league, players, state }) {
  const byEspnId = new Map();
  players.forEach((player, i) => {
    if (player.espnId) byEspnId.set(player.espnId, i);
  });

  // Random draft order: the moment ESPN publishes it (or your own first-round pick
  // appears), lock the slot in. One shot: a slot set by hand or by an earlier poll is
  // never overwritten.
  let slot = null;
  if (!league.slot && league.team) {
    if (draft.orderFinal && Array.isArray(draft.pickOrder)) {
      const k = draft.pickOrder.indexOf(league.team);
      if (k >= 0) slot = k + 1;
    }
    if (slot === null) {
      const own = (draft.picks || []).find(
        (pick) => pick.team === league.team && pick.overall <= league.teams,
      );
      if (own) slot = own.overall;
    }
  }

  const drafted = [];
  const mine = [];
  let offBoard = 0;
  for (const pick of draft.picks || []) {
    const i = byEspnId.get(pick.player);
    if (i === undefined) {
      offBoard++; // taken, but not on our board
      continue;
    }
    if (!state.drafted.has(i)) drafted.push(i);
    if (pick.team === league.team && !state.mine.has(i)) mine.push(i);
  }

  // Until ESPN actually has picks the badge says nothing: an offline league drafts
  // elsewhere and the idle chatter only distracts. The poll keeps running, so the
  // moment a live draft produces picks the badge appears.
  const count = (draft.picks || []).length;
  let badge = BADGE_OFF;
  if (count || draft.inProgress) {
    const extra = offBoard ? ` · ${offBoard} off-board` : "";
    badge = {
      state: draft.inProgress ? "live" : "synced",
      text: count
        ? `${count} pick${count === 1 ? "" : "s"} from ESPN${extra}`
        : "draft live on ESPN",
    };
  }

  return { drafted, mine, offBoard, done: Boolean(draft.drafted), slot, badge };
}

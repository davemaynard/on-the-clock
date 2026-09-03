// Live sync from ESPN, served only by the local draft room. Additive by design: a pick
// ESPN reports gets marked, but nothing here ever un-marks a player. You may know a
// pick before ESPN does, especially in an offline league where ESPN only knows what
// the commissioner has typed, so a tap must never be overwritten by a feed that is
// behind.

const POLL_MS = 5000;

/**
 * Poll the local server for the league's draft and merge picks into `state`.
 * `onChange` is called after anything changed; `onBadge(state, text)` updates the
 * badge; `setSlot` locks in a slot revealed by the feed.
 */
export function startLiveSync({ league, players, state, onChange, onBadge, setSlot }) {
  const byEspnId = new Map();
  players.forEach((player, i) => {
    if (player.espnId) byEspnId.set(player.espnId, i);
  });

  const poll = async () => {
    try {
      const response = await fetch(`/api/draft?league=${league.leagueId}`, { cache: "no-store" });
      const draft = await response.json();
      if (!draft.ok) {
        onBadge("off", "");
        return;
      }
      // Random draft order: the moment ESPN publishes it (or your own first-round
      // pick appears), lock the slot in. One shot: a slot set by hand or by an
      // earlier poll is never overwritten.
      if (!league.slot && league.team) {
        if (draft.orderFinal && Array.isArray(draft.pickOrder)) {
          const k = draft.pickOrder.indexOf(league.team);
          if (k >= 0) setSlot(k + 1);
        }
        if (!league.slot) {
          const own = (draft.picks || []).find(
            (pick) => pick.team === league.team && pick.overall <= league.teams,
          );
          if (own) setSlot(own.overall);
        }
      }

      let changed = 0;
      let offBoard = 0;
      for (const pick of draft.picks) {
        const i = byEspnId.get(pick.player);
        if (i === undefined) {
          offBoard++; // taken, but not on our board
          continue;
        }
        if (!state.drafted.has(i)) {
          state.drafted.add(i);
          changed++;
        }
        if (pick.team === league.team && !state.mine.has(i)) {
          state.mine.add(i);
          changed++;
        }
      }
      // ESPN picks of players beyond the board's depth still consume picks: feed
      // them into the clock so "picks away" stays right late in the draft, when
      // off-board names are the norm.
      if (offBoard > (league.feedOffBoard || 0)) {
        league.feedOffBoard = offBoard;
        changed++;
      }
      if (draft.drafted && !league.done) {
        league.done = true;
        changed++;
      }
      if (changed) onChange();

      // Until ESPN actually has picks the badge says nothing: an offline league
      // drafts elsewhere and the idle chatter only distracts. The poll keeps
      // running, so the moment a live draft produces picks the badge appears.
      const count = draft.picks.length;
      if (!count && !draft.inProgress) {
        onBadge("off", "");
        return;
      }
      const extra = offBoard ? ` · ${offBoard} off-board` : "";
      const label = count
        ? `${count} pick${count === 1 ? "" : "s"} from ESPN${extra}`
        : "draft live on ESPN";
      onBadge(draft.inProgress ? "live" : "synced", label);
    } catch {
      onBadge("off", "");
    }
  };

  poll();
  setInterval(poll, POLL_MS);
}

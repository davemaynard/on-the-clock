// Applies the ESPN feed to one league: polls the local server and folds each answer
// into the draft state, the slot and the badge. The merge itself is pure (model/live.ts).
import { useEffect, useRef, useState } from "preact/hooks";
import { BADGE_OFF, type Badge, fetchDraft, mergeFeed, POLL_MS } from "../model/live.ts";
import type { DraftState } from "../model/model.ts";
import type { League, Player } from "../model/types.ts";
import type { DraftDispatch } from "./useDraft.ts";

export interface Feed {
  /** ESPN's count of picks spent on players beyond the board's depth. */
  offBoard: number;
  done: boolean;
  badge: Badge;
}

const QUIET: Feed = { offBoard: 0, done: false, badge: BADGE_OFF };

interface LiveSyncInputs {
  enabled: boolean;
  league: Pick<League, "leagueId" | "team" | "teams">;
  players: Player[];
  slot: number;
  setSlot: (next: number) => void;
  state: DraftState;
  dispatch: DraftDispatch;
}

/** The feed's view of the draft, refreshed every few seconds while `enabled`. */
export function useLiveSync({
  enabled,
  league,
  players,
  slot,
  setSlot,
  state,
  dispatch,
}: LiveSyncInputs): Feed {
  const [feed, setFeed] = useState(QUIET);
  // The poll reads whatever is current without restarting on every render.
  const latest = useRef({ slot, state, feed });
  latest.current = { slot, state, feed };

  useEffect(() => {
    if (!enabled || !league.leagueId) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const draft = await fetchDraft(league.leagueId);
        if (cancelled) return;
        if (!draft) {
          setFeed((current) => ({ ...current, badge: BADGE_OFF }));
          return;
        }
        const current = latest.current;
        const merged = mergeFeed(draft, {
          league: { team: league.team, teams: league.teams, slot: current.slot },
          players,
          state: current.state,
        });
        if (merged.slot) setSlot(merged.slot);
        if (merged.drafted.length || merged.mine.length) {
          dispatch({ type: "feed", drafted: merged.drafted, mine: merged.mine });
        }
        setFeed({
          offBoard: Math.max(current.feed.offBoard, merged.offBoard),
          done: current.feed.done || merged.done,
          badge: merged.badge,
        });
      } catch {
        if (!cancelled) setFeed((current) => ({ ...current, badge: BADGE_OFF }));
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, league, players, setSlot, dispatch]);

  return feed;
}

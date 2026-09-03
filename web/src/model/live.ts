// Live sync from ESPN, served only by the local draft room. Additive by design: a pick
// ESPN reports gets marked, but nothing here ever un-marks a player. You may know a
// pick before ESPN does, especially in an offline league where ESPN only knows what
// the commissioner has typed, so a tap must never be overwritten by a feed that is
// behind. The merge is a pure function of one poll; the hook that applies it lives with
// the components.
import type { DraftState } from "./model.ts";
import type { Player } from "./types.ts";

export const POLL_MS = 5000;

/** What the local server says about one league's draft. */
export interface FeedDraft {
  ok: boolean;
  inProgress?: boolean;
  /** The draft is over. */
  drafted?: boolean;
  orderFinal?: boolean;
  /** Team ids in draft order, once published. */
  pickOrder?: number[];
  picks?: FeedPick[];
}

export interface FeedPick {
  /** ESPN player id. */
  player: number;
  team: number;
  overall: number;
}

export interface Badge {
  state: "off" | "live" | "synced";
  text: string;
}

/** The badge when the feed has nothing to say. */
export const BADGE_OFF: Badge = { state: "off", text: "" };

/** What the merge needs to know about the league: your team, its size, the slot so far. */
export interface FeedLeague {
  team: number | null;
  teams: number;
  /** 0 or null when unknown. */
  slot: number | null;
}

export interface FeedMerge {
  /** Row indices newly gone. */
  drafted: number[];
  /** Row indices newly yours. */
  mine: number[];
  /** Picks ESPN reports spent on players not on the board. */
  offBoard: number;
  done: boolean;
  /** A slot to lock in, or null. */
  slot: number | null;
  badge: Badge;
}

/** Ask the local server for one league's draft. Null when it has none to give. */
export async function fetchDraft(leagueId: string): Promise<FeedDraft | null> {
  const response = await fetch(`/api/draft?league=${leagueId}`, { cache: "no-store" });
  const draft = (await response.json()) as FeedDraft;
  return draft.ok ? draft : null;
}

/** What one ESPN poll changes, without applying it. */
export function mergeFeed(
  draft: FeedDraft,
  { league, players, state }: { league: FeedLeague; players: Player[]; state: DraftState },
): FeedMerge {
  const byEspnId = new Map<number, number>();
  players.forEach((player, i) => {
    if (player.espnId) byEspnId.set(player.espnId, i);
  });
  const picks = draft.picks || [];

  // Random draft order: the moment ESPN publishes it (or your own first-round pick
  // appears), lock the slot in. One shot: a slot set by hand or by an earlier poll is
  // never overwritten.
  let slot: number | null = null;
  if (!league.slot && league.team) {
    if (draft.orderFinal && Array.isArray(draft.pickOrder)) {
      const k = draft.pickOrder.indexOf(league.team);
      if (k >= 0) slot = k + 1;
    }
    if (slot === null) {
      const own = picks.find((pick) => pick.team === league.team && pick.overall <= league.teams);
      if (own) slot = own.overall;
    }
  }

  const drafted: number[] = [];
  const mine: number[] = [];
  let offBoard = 0;
  for (const pick of picks) {
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
  const count = picks.length;
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

// The data contract between the Python side and the browser. page.py writes this shape
// into window.ON_THE_CLOCK; everything on screen is derived from it. Change one side,
// change the other.

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

/** Your calls from marks.toml, or empty. `alert` prints as "news". */
export type Mark = "" | "target" | "fade" | "alert" | "slp";

/**
 * One row on the board. `players` walks the Python rows in order, so a row's index on
 * the board is its index in the array; the draft state is sets of these indices.
 */
export interface Player {
  name: string;
  pos: Position;
  posRank: number;
  team: string;
  /** Value over the news-adjusted projection. 0 for a stub. */
  vor: number;
  /** Consensus draft position; 999 when the market never drafts him, so he sorts last. */
  adp: number;
  espnId: number;
  /** K and DST: priced against the waiver wire, never proposed before the endgame. */
  streamer: boolean;
  mark: Mark;
  why: string;
  proj: number | null;
  adjProj: number | null;
  /** A reprice verdict ("AVOID", "STASH 160+"), or empty. */
  verdict: string;
  /** A marked name ESPN carries without a projection: the numbers are placeholders. */
  stub: boolean;
  /** ESPN's injury status enum. */
  status: string;
  /** Out, Doubtful, IR or suspended. */
  out: boolean;
}

/** A flex-family slot: how many, and which positions may fill it. */
export interface FlexFamily {
  label: string;
  count: number;
  eligible: Position[];
}

/** Starting slots by position; positions the league doesn't start are absent. */
export type SlotCounts = Partial<Record<Position, number>>;

export interface LineupItem {
  count: number;
  label: string;
}

export interface ScriptStep {
  round: string;
  pick: number;
  text: string;
}

/** Value of the best player left at one position at each of the first eight picks. */
export interface CurveRow {
  pos: Position;
  values: number[];
}

export interface HurtPlayer {
  name: string;
  pos: Position;
  posRank: number;
  status: string;
  mark: Mark;
}

export interface League {
  index: number;
  /** The storage namespace for this league's state. */
  key: string;
  name: string;
  leagueId: string;
  /** Your ESPN team id, when known; the live feed uses it to spot your picks. */
  team: number | null;
  teams: number;
  /** Your draft slot, or null when the order wasn't out at build time. */
  slot: number | null;
  roundsTotal: number;
  bench: number;
  picks: number[];
  slots: SlotCounts;
  families: FlexFamily[];
  flex: number;
  lineup: LineupItem[];
  principles: string[];
  script: ScriptStep[];
  curve: CurveRow[];
  hurt: HurtPlayer[];
  players: Player[];
}

export interface Payload {
  /** Whether the local server is serving, and so the ESPN poller may run. */
  live: boolean;
  year: number;
  leagues: League[];
}

declare global {
  interface Window {
    ON_THE_CLOCK: Payload;
  }
}

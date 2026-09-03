// The draft model: pure functions over the league payload and the live state. Nothing
// here touches the DOM, so every rule can be tested on its own.
import type { FlexFamily, Player, Position, SlotCounts } from "./types.ts";

export const SKILL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];
export const ALL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
// Roster slots print in this order: defense before kicker, the way ESPN lists them.
const STREAMED: Position[] = ["DST", "K"];

/** What the model needs to know about a league: its lineup, your picks, the feed's view. */
export interface DraftLeague {
  picks: number[];
  slots: SlotCounts;
  families: FlexFamily[];
  /** Picks ESPN reports spent on players beyond the board, merged with the manual count. */
  feedOffBoard?: number;
  /** ESPN says the draft is over. */
  done?: boolean;
}

/** What's gone and what's yours, as row indices, plus picks of players not on the board. */
export interface DraftState {
  drafted: Set<number>;
  mine: Set<number>;
  offBoard: number;
}

/* ---- picks ------------------------------------------------------------------------ */

/** The overall pick numbers one slot gets in a snake draft. */
export function snakePicks(slot: number, teams: number, rounds: number): number[] {
  const picks: number[] = [];
  for (let round = 1; round <= rounds; round++) {
    const position = round % 2 ? slot : teams - slot + 1;
    picks.push((round - 1) * teams + position);
  }
  return picks;
}

/** Your next pick once `drafted` players are gone, or null when you have none left. */
export function nextPick(picks: number[], drafted: number): number | null {
  const onClock = drafted + 1;
  for (const pick of picks) if (pick >= onClock) return pick;
  return null;
}

/* ---- availability, conditioned on the real draft --------------------------------- */

// The static board assumed a player's ADP was all we knew. Once picks are recorded we
// know something stronger: how many players the market rates above him are still on
// the board. If `better` of them remain and `picks` separate you from your turn, he
// survives when the room reaches past him. Uncertainty widens with the horizon: forty
// picks out, nobody's queue holds.

/** The standard normal CDF (Abramowitz and Stegun 26.2.17, good to 1e-7). */
const normalCdf = (z: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = 0.3989423 * Math.exp((-z * z) / 2);
  const poly = 1.330274 * t ** 4 - 1.821256 * t ** 3 + 1.781478 * t * t - 0.356538 * t + 0.319381;
  const tail = density * t * poly;
  return z > 0 ? 1 - tail : tail;
};

/** Chance a player survives `picks` more picks when `better` market-ranked players remain. */
export function survives(better: number, picks: number): number {
  if (picks <= 0) return 1;
  const sigma = 0.35 * picks + 2;
  return Math.min(1, Math.max(0, 1 - normalCdf((picks - better) / sigma)));
}

/** Player index to how many available players the market rates above him. */
export function marketQueue(players: Player[], drafted: Set<number>): Map<number, number> {
  const byAdp = players.map((_, i) => i).sort((a, b) => players[a].adp - players[b].adp);
  const queue = new Map<number, number>();
  let ahead = 0;
  for (const index of byAdp) {
    if (drafted.has(index)) continue;
    queue.set(index, ahead);
    ahead++;
  }
  return queue;
}

/* ---- roster need: the cost of waiting -------------------------------------------- */

// Need is not a constant. It is the cost of waiting: what the best available at a
// position loses between your next pick and the pick after it, measured on the live
// pool with the same survival model the candidates use. A tier evaporating collapses
// the number (never chase a run you already missed); a run starting in front of you
// inflates it. An open slot whose wait-cost is about zero is a slot the league will
// fill for free later.

type ByPosition = Record<Position, number>;

const zeroByPosition = (): ByPosition => ({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 });

/** Open starting slots by position, and how many slots each flex family still has open. */
export function openSlots(league: DraftLeague, players: Player[], mine: Set<number>) {
  const owned = zeroByPosition();
  for (const index of mine) owned[players[index].pos]++;
  const open = zeroByPosition();
  for (const pos of ALL_POSITIONS) {
    open[pos] = Math.max(0, (league.slots[pos] || 0) - owned[pos]);
  }
  // Flex families (FLEX, OP/superflex, ...) come narrowest first. Each absorbs the
  // surplus at its eligible positions; what it can't absorb is an opening. In a
  // superflex league a second QB fills the OP slot instead of counting as a luxury.
  const families = league.families || [];
  const surplus = zeroByPosition();
  for (const pos of SKILL_POSITIONS) {
    surplus[pos] = Math.max(0, owned[pos] - (league.slots[pos] || 0));
  }
  const familyOpen = families.map((family) => {
    let remaining = family.count;
    for (const pos of family.eligible) {
      if (!remaining) break;
      const used = Math.min(remaining, surplus[pos]);
      surplus[pos] -= used;
      remaining -= used;
    }
    return remaining;
  });
  return { open, familyOpen, families };
}

interface WaitCostInputs {
  players: Player[];
  drafted: Set<number>;
  queue: Map<number, number>;
  /** Picks between your next turn and the one after, or null when there is no next. */
  picksUntilFollowing: number | null;
  families: FlexFamily[];
}

/**
 * Cost of waiting for each position and each flex family: projected points the best
 * available loses between your next pick and the one after.
 */
export function waitCosts({
  players,
  drafted,
  queue,
  picksUntilFollowing,
  families,
}: WaitCostInputs) {
  const healthy = players
    .map((_, i) => i)
    .filter((i) => !drafted.has(i) && !players[i].streamer && !players[i].out);
  const cost = (eligible: (pos: Position) => boolean): number => {
    const pool = healthy.filter((i) => eligible(players[i].pos));
    if (!pool.length || picksUntilFollowing === null) return 0;
    const now = Math.max(...pool.map((i) => players[i].vor));
    const likelyLater = pool
      .filter((i) => survives(queue.get(i) ?? 0, picksUntilFollowing) >= 0.5)
      .map((i) => players[i].vor);
    // Nobody at the position is likely to last: price the worst case.
    const later = likelyLater.length
      ? Math.max(...likelyLater)
      : Math.min(...pool.map((i) => players[i].vor));
    return Math.max(0, now - later);
  };
  // K and DST included so the bonus never reads an undefined cost when a scored
  // streamer is scored; healthy excludes streamers, so their cost is zero, which is
  // also the right answer.
  const byPosition = zeroByPosition();
  for (const pos of ALL_POSITIONS) byPosition[pos] = cost((p) => p === pos);
  const byFamily = families.map((family) => cost((p) => family.eligible.includes(p)));
  return { byPosition, byFamily };
}

/* ---- the state of the draft, from your seat ------------------------------------- */

/**
 * Everything the assistant and the board need, derived fresh from the league payload
 * and the live state. Pure: call it every render.
 */
export function assess(league: DraftLeague, players: Player[], state: DraftState) {
  // Off-board picks advance the clock too: the larger of the manual count and the
  // live feed's own off-board tally, merged via max so a hand-entered pick the feed
  // later confirms is never counted twice.
  const drafted = state.drafted.size + Math.max(state.offBoard || 0, league.feedOffBoard || 0);
  const next = nextPick(league.picks, drafted);
  const onClock = next !== null && next === drafted + 1;
  const picksAway = next === null ? 0 : Math.max(0, next - drafted - 1);
  const following = next === null ? null : (league.picks.find((pick) => pick > next) ?? null);
  const picksUntilFollowing = following === null ? null : Math.max(0, following - drafted - 2);

  const available = players.map((_, i) => i).filter((i) => !state.drafted.has(i));
  const queue = marketQueue(players, state.drafted);
  const { open, familyOpen, families } = openSlots(league, players, state.mine);
  const costs = waitCosts({
    players,
    drafted: state.drafted,
    queue,
    picksUntilFollowing,
    families,
  });
  const flexOpen = familyOpen.reduce((a, b) => a + b, 0);
  const inAnyFamily = (pos: Position) => families.some((family) => family.eligible.includes(pos));

  // Endgame guard: once open slots meet remaining skill picks, filling the lineup
  // beats any value argument.
  const picksLeft = league.picks.filter((pick) => pick > drafted).length;
  const streamersNeeded = open.K + open.DST;
  const openSkill = open.QB + open.RB + open.WR + open.TE + flexOpen;
  const forced = next !== null && picksLeft - streamersNeeded <= openSkill;
  // Endgame proper: every pick you have left is a K or D/ST pick AND nothing else in
  // the lineup is open. Both halves matter: openSkill === 0 alone would dim the skill
  // board through the bench rounds, and picksLeft <= streamersNeeded alone hides a
  // still-empty starting slot behind a kicker when the picks ran short. When the
  // roster is short a starter, `forced` runs the board instead.
  const endgame = next !== null && picksLeft > 0 && picksLeft <= streamersNeeded && openSkill === 0;

  /** A position is exhausted when its own slots are filled and no open flex can take it. */
  const exhausted = (pos: Position): boolean =>
    !open[pos] && !families.some((family, k) => familyOpen[k] > 0 && family.eligible.includes(pos));

  const bonus = (pos: Position): number => {
    if (open[pos] > 0) return forced ? 99 : costs.byPosition[pos];
    for (let k = 0; k < families.length; k++) {
      if (familyOpen[k] > 0 && families[k].eligible.includes(pos)) {
        return forced ? 60 : costs.byFamily[k];
      }
    }
    return inAnyFamily(pos) ? 0 : -25;
  };
  /** VOR plus the roster-need bonus: the number the green rails rank by. */
  const fit = (i: number): number => players[i].vor + (players[i].out ? 0 : bonus(players[i].pos));

  // Injured and suspended players stay on the board with their tag and are never
  // proposed, except marked sleepers, whose reduced projection still clears
  // replacement. They earn no need bonus (they can't start week one), so they only
  // surface once their raw value tops what's left: the late-draft IR-stash zone.
  // In endgame the shop inverts: only K and D/ST filling an open slot are candidates.
  const ranked = available
    .filter((i) => {
      const p = players[i];
      const wanted = endgame ? p.streamer && open[p.pos] > 0 : !p.streamer;
      return wanted && (!p.out || p.mark === "slp");
    })
    .sort((a, b) => fit(b) - fit(a));

  return {
    drafted,
    next,
    following,
    onClock,
    picksAway,
    picksLeft,
    queue,
    open,
    familyOpen,
    families,
    flexOpen,
    costs,
    forced,
    endgame,
    streamersNeeded,
    openSkill,
    exhausted,
    fit,
    ranked,
    /** The three best fits get a green rail; in endgame exactly one. */
    recommended: new Set(ranked.slice(0, endgame ? 1 : 3)),
    /** Chance a player is still there at your next pick. */
    chance: (i: number): number => survives(queue.get(i) ?? 0, picksAway),
  };
}

export type Assessment = ReturnType<typeof assess>;

/** The one-line answer as data: the focus is the term the view sets in bold. */
export interface Advice {
  before: string;
  focus: string;
  after: string;
}

/**
 * The one-line answer to "what am I shopping for right now". Null when there is
 * nothing to say.
 */
export function advice(league: DraftLeague, assessment: Assessment): Advice | null {
  const { next, following, endgame, forced, open, picksLeft, streamersNeeded, openSkill } =
    assessment;
  const { familyOpen, families, flexOpen, costs } = assessment;
  const say = (before: string, focus: string, after = ""): Advice => ({ before, focus, after });
  if (!league.picks.length) {
    return say(
      "Draft order not out. ",
      "Set your slot",
      " above to arm the pick math. The board and live sync work either way.",
    );
  }
  if (next === null) return null;
  if (endgame) return say("Optimize for ", "K / D/ST", ": last picks");

  const starters = SKILL_POSITIONS.filter((pos) => open[pos] > 0);
  // Can go to zero or below once the K and D/ST picks are spoken for and a starting
  // slot is still empty: say so rather than printing "0 picks".
  const skillPicksLeft = picksLeft - streamersNeeded;
  if (forced && starters.length) {
    const picks =
      skillPicksLeft > 0
        ? `${skillPicksLeft} pick${skillPicksLeft === 1 ? "" : "s"}`
        : "no picks to spare";
    return say(
      "Fill ",
      starters.join(" / "),
      ` now: ${openSkill} slot${openSkill === 1 ? "" : "s"}, ${picks}`,
    );
  }
  if (starters.length) {
    const pos = starters.sort((a, b) => costs.byPosition[b] - costs.byPosition[a])[0];
    const cost = Math.round(costs.byPosition[pos]);
    if (cost >= 4) {
      return say(
        "Optimize for ",
        pos,
        `: waiting past ${following ?? "your next pick"} costs ~${cost} pts`,
      );
    }
    return say(
      `Open slot${starters.length === 1 ? "" : "s"} (${starters.join(", ")}) cheap later, take `,
      "value",
    );
  }
  if (flexOpen > 0) {
    const k = familyOpen.findIndex((count) => count > 0);
    const cost = Math.round(costs.byFamily[k] || 0);
    return say(
      "Optimize for ",
      families[k].label,
      `: ${familyOpen[k]} open${cost >= 4 ? `, waiting costs ~${cost} pts` : ""}`,
    );
  }
  return say("Optimize for ", "RB/WR depth", ": starters filled");
}

/** The advice as one plain string, for tests and logs. */
export const adviceText = (parts: Advice | null): string =>
  parts ? `${parts.before}${parts.focus}${parts.after}` : "";

/** A starting slot on your roster, and who fills it. */
export interface RosterSlot {
  label: string;
  player: Player | null;
}

/** Greedily fill the real starting lineup with what you own; the rest is the bench. */
export function fillLineup(league: DraftLeague, players: Player[], mine: Set<number>) {
  const pool = [...mine].map((i) => players[i]).sort((a, b) => b.vor - a.vor);
  const slots: RosterSlot[] = [];
  const take = (eligible: (p: Player) => boolean, label: string) => {
    const k = pool.findIndex(eligible);
    slots.push({ label, player: k >= 0 ? pool.splice(k, 1)[0] : null });
  };
  for (const pos of SKILL_POSITIONS) {
    for (let n = 0; n < (league.slots[pos] || 0); n++) take((p) => p.pos === pos, pos);
  }
  for (const family of league.families || []) {
    for (let n = 0; n < family.count; n++)
      take((p) => family.eligible.includes(p.pos), family.label);
  }
  for (const pos of STREAMED) {
    for (let n = 0; n < (league.slots[pos] || 0); n++) take((p) => p.pos === pos, pos);
  }
  return { slots, bench: pool };
}

export type Lineup = ReturnType<typeof fillLineup>;

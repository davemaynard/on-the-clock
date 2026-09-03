// The rescue code: a draft's state as one short line of text, so it can be moved to
// another device or restored after a browser evicts the tab. Row indices are
// delta-encoded in base 36; a hundred picks stays well inside a line.
import type { DraftState } from "./model.ts";

const encodeIndices = (indices: Iterable<number>): string => {
  const sorted = [...indices].sort((a, b) => a - b);
  let previous = 0;
  return sorted
    .map((index) => {
      const delta = index - previous;
      previous = index;
      return delta.toString(36);
    })
    .join(".");
};

const decodeIndices = (text: string): Set<number> => {
  const out = new Set<number>();
  let previous = 0;
  for (const part of text.split(".")) {
    if (!part) continue;
    previous += Number.parseInt(part, 36);
    if (Number.isFinite(previous)) out.add(previous);
  }
  return out;
};

/** The state as a code. */
export function encodeState(state: DraftState): string {
  return `${encodeIndices(state.drafted)}~${encodeIndices(state.mine)}~${(state.offBoard || 0).toString(36)}`;
}

/** A code back to a state. Garbage decodes to an empty state. */
export function decodeState(code: string): DraftState {
  const [drafted, mine, offBoard] = String(code).trim().split("~");
  return {
    drafted: decodeIndices(drafted || ""),
    mine: decodeIndices(mine || ""),
    offBoard: Number.parseInt(offBoard || "0", 36) || 0,
  };
}

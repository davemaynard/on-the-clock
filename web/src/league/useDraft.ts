// One league's draft state: which rows are gone, which are yours, how many picks went to
// players who aren't on the board, and the undo history. A reducer, so every gesture is
// a named action and the whole thing persists as one object.
import { type Dispatch, useEffect, useReducer } from "preact/hooks";
import type { DraftState } from "../model/model.ts";
import { decodeState } from "../model/rescue.ts";
import { readJson, storageKey, writeJson } from "../model/storage.ts";

const HISTORY_LIMIT = 40;

/** The state as it is written to storage: arrays, since Sets don't serialize. */
interface SavedState {
  drafted: number[];
  mine: number[];
  offBoard: number;
}

export interface DraftHistoryState extends DraftState {
  /** Snapshots before each change, oldest first; Undo pops the last. */
  history: SavedState[];
}

/** Every gesture the page can make on the draft. */
export type DraftAction =
  /** A tap on a row: marks him drafted, or takes it back (and his claim with it). */
  | { type: "tap"; index: number }
  /** His + button: yours, or not; yours implies gone. */
  | { type: "claim"; index: number }
  /** From the best-available list: always marks him gone, and yours when asked. */
  | { type: "draft"; index: number; mine: boolean }
  | { type: "offBoard"; delta: number }
  /** ESPN's picks: additive, and not undoable, since nothing you did produced them. */
  | { type: "feed"; drafted: number[]; mine: number[] }
  | { type: "restore"; code: string }
  | { type: "reset" }
  | { type: "undo" };

export type DraftDispatch = Dispatch<DraftAction>;

const toSaved = (state: DraftState): SavedState => ({
  drafted: [...state.drafted],
  mine: [...state.mine],
  offBoard: state.offBoard,
});

/** Mine always implies drafted, whatever the source said. */
const normalized = ({ drafted, mine, offBoard }: DraftState): DraftState => {
  const all = new Set(drafted);
  for (const i of mine) all.add(i);
  return { drafted: all, mine: new Set(mine), offBoard: offBoard || 0 };
};

/** Sets from arrays. */
const fromSaved = (saved: Partial<SavedState> | null): DraftState =>
  normalized({
    drafted: new Set(saved?.drafted || []),
    mine: new Set(saved?.mine || []),
    offBoard: saved?.offBoard || 0,
  });

interface Keys {
  state: string;
  history: string;
}

const load = (keys: Keys): DraftHistoryState => ({
  ...fromSaved(readJson<SavedState | null>(keys.state, null)),
  history: readJson<SavedState[]>(keys.history, []),
});

/** The history with the current state pushed, capped: forty snapshots is a few kilobytes. */
const remember = (state: DraftHistoryState): SavedState[] => {
  const history = [...state.history, toSaved(state)];
  if (history.length > HISTORY_LIMIT) history.shift();
  return history;
};

function reduce(state: DraftHistoryState, action: DraftAction): DraftHistoryState {
  const drafted = new Set(state.drafted);
  const mine = new Set(state.mine);
  switch (action.type) {
    case "tap": {
      if (drafted.has(action.index)) {
        drafted.delete(action.index);
        mine.delete(action.index);
      } else {
        drafted.add(action.index);
      }
      return { ...state, drafted, mine, history: remember(state) };
    }
    case "claim": {
      if (mine.has(action.index)) {
        mine.delete(action.index);
        drafted.delete(action.index);
      } else {
        mine.add(action.index);
        drafted.add(action.index);
      }
      return { ...state, drafted, mine, history: remember(state) };
    }
    case "draft": {
      drafted.add(action.index);
      if (action.mine) mine.add(action.index);
      return { ...state, drafted, mine, history: remember(state) };
    }
    case "offBoard": {
      const offBoard = Math.max(0, state.offBoard + action.delta);
      if (offBoard === state.offBoard) return state;
      return { ...state, offBoard, history: remember(state) };
    }
    case "feed": {
      for (const i of action.drafted) drafted.add(i);
      for (const i of action.mine) {
        mine.add(i);
        drafted.add(i);
      }
      const changed = drafted.size !== state.drafted.size || mine.size !== state.mine.size;
      return changed ? { ...state, drafted, mine } : state;
    }
    case "restore": {
      return { ...normalized(decodeState(action.code)), history: remember(state) };
    }
    case "reset": {
      return { drafted: new Set(), mine: new Set(), offBoard: 0, history: remember(state) };
    }
    case "undo": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return { ...fromSaved(previous), history: state.history.slice(0, -1) };
    }
  }
}

/**
 * The draft state for one league and its dispatcher. Loads from this browser's storage
 * and writes back after every change; the storage module says nothing if it can't.
 */
export function useDraft(leagueKey: string): [DraftHistoryState, DraftDispatch] {
  const keys: Keys = {
    state: storageKey(leagueKey),
    history: storageKey(leagueKey, "history"),
  };
  const [state, dispatch] = useReducer<DraftHistoryState, DraftAction, Keys>(reduce, keys, load);
  useEffect(() => {
    writeJson(keys.state, toSaved(state));
    writeJson(keys.history, state.history);
  }, [state, keys.state, keys.history]);
  return [state, dispatch];
}

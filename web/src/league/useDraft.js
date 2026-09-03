// One league's draft state: which rows are gone, which are yours, how many picks went to
// players who aren't on the board, and the undo history. A reducer, so every gesture is
// a named action and the whole thing persists as one object.
import { useEffect, useReducer } from "preact/hooks";
import { decodeState } from "../model/rescue.js";
import { readJson, storageKey, writeJson } from "../model/storage.js";

const HISTORY_LIMIT = 40;

const toSaved = (state) => ({
  drafted: [...state.drafted],
  mine: [...state.mine],
  offBoard: state.offBoard,
});

/** Sets from arrays, and mine always implies drafted. */
const fromSaved = (saved) => {
  const drafted = new Set(saved?.drafted || []);
  const mine = new Set(saved?.mine || []);
  for (const i of mine) drafted.add(i);
  return { drafted, mine, offBoard: saved?.offBoard || 0 };
};

const load = (keys) => ({
  ...fromSaved(readJson(keys.state, null)),
  history: (readJson(keys.history, null) || []).map(fromSaved),
});

/** The history with the current state pushed, capped: forty snapshots is a few kilobytes. */
const remember = (state) => {
  const history = [...state.history, toSaved(state)];
  if (history.length > HISTORY_LIMIT) history.shift();
  return history;
};

function reduce(state, action) {
  const drafted = new Set(state.drafted);
  const mine = new Set(state.mine);
  switch (action.type) {
    // A tap on a row: marks him drafted, or takes it back (and his claim with it).
    case "tap": {
      if (drafted.has(action.index)) {
        drafted.delete(action.index);
        mine.delete(action.index);
      } else {
        drafted.add(action.index);
      }
      return { ...state, drafted, mine, history: remember(state) };
    }
    // His + button: yours, or not; yours implies gone.
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
    // From the best-available list: always marks him gone, and yours when asked.
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
    // ESPN's picks: additive, and not undoable, since nothing you did produced them.
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
      return { ...fromSaved(decodeState(action.code)), history: remember(state) };
    }
    case "reset": {
      return { drafted: new Set(), mine: new Set(), offBoard: 0, history: remember(state) };
    }
    case "undo": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return { ...fromSaved(previous), history: state.history.slice(0, -1) };
    }
    default:
      return state;
  }
}

/**
 * The draft state for one league and its dispatcher. Loads from this browser's storage
 * and writes back after every change; the storage module says nothing if it can't.
 */
export function useDraft(leagueKey) {
  const keys = { state: storageKey(leagueKey), history: storageKey(leagueKey, "history") };
  const [state, dispatch] = useReducer(reduce, keys, load);
  useEffect(() => {
    writeJson(keys.state, toSaved(state));
    writeJson(keys.history, state.history);
  }, [state, keys.state, keys.history]);
  return [state, dispatch];
}

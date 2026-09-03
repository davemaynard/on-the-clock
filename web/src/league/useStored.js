// Small per-viewer preferences that survive a reload: the assistant fold, the score
// mode, the slot you set by hand.
import { useCallback, useMemo, useState } from "preact/hooks";
import { snakePicks } from "../model/model.js";
import { read, storageKey, write } from "../model/storage.js";

/** A boolean saved under `key`, as "1" or "0". */
export function useStoredFlag(key, initial = false) {
  const [value, setValue] = useState(() => {
    const saved = read(key);
    return saved === null ? initial : saved === "1";
  });
  const set = useCallback(
    (next) => {
      setValue(next);
      write(key, next ? "1" : "0");
    },
    [key],
  );
  return [value, set];
}

/**
 * Your draft slot and the pick numbers it earns. The slot may be unknown until an hour
 * before the draft (random order). Sources, in trust order: the payload (rebuilt after
 * the reveal), a slot saved in this browser, the ESPN feed, the picker. Once set from
 * any source the feed never overwrites it: a human correction must stick.
 */
export function useSlot(league) {
  const key = storageKey(league.key, "slot");
  const [slot, setSlotValue] = useState(() => {
    if (league.slot) return league.slot;
    const saved = Number.parseInt(read(key) || "", 10);
    return saved >= 1 && saved <= league.teams ? saved : 0;
  });
  const setSlot = useCallback(
    (next) => {
      if (!(next >= 1 && next <= league.teams)) return;
      setSlotValue(next);
      write(key, String(next));
    },
    [key, league.teams],
  );
  const picks = useMemo(
    () => (slot ? snakePicks(slot, league.teams, league.roundsTotal) : []),
    [slot, league.teams, league.roundsTotal],
  );
  return { slot, setSlot, picks };
}

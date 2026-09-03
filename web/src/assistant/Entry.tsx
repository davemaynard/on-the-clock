import type { DraftDispatch } from "../league/useDraft.ts";
import styles from "./Entry.module.css";

interface Props {
  offBoard: number;
  canUndo: boolean;
  dispatch: DraftDispatch;
}

/** Manual entry: picks of players who aren't on the board, and the way back. */
export function Entry({ offBoard, canUndo, dispatch }: Props) {
  return (
    <div class={styles.entry}>
      <button
        class={styles.button}
        type="button"
        aria-label="Remove an unlisted pick"
        title="Undo a +1: removes one off-board pick from the count"
        onClick={() => dispatch({ type: "offBoard", delta: -1 })}
      >
        −1
      </button>
      <button
        class={styles.add}
        type="button"
        title="Someone drafted a player who isn't on this board: count the pick so the clock stays right"
        onClick={() => dispatch({ type: "offBoard", delta: 1 })}
      >
        <b>+1</b> off-board pick
      </button>
      <span class={styles.count} aria-live="polite">
        {offBoard ? `${offBoard} unlisted` : ""}
      </span>
      <button
        class={styles.undo}
        type="button"
        disabled={!canUndo}
        onClick={() => dispatch({ type: "undo" })}
      >
        Undo
      </button>
    </div>
  );
}

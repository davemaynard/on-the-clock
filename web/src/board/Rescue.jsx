import { encodeState } from "../model/rescue.js";
import { storageAvailable } from "../model/storage.js";
import shared from "../styles/shared.module.css";
import styles from "./Rescue.module.css";

/** The draft as one line of text, for moving to another device or surviving an eviction. */
export function Rescue({ state, dispatch }) {
  // Native dialogs on purpose: two actions a year, and they work offline on every phone.
  const restore = () => {
    const code = prompt("Paste a saved draft code:");
    if (code) dispatch({ type: "restore", code });
  };
  const reset = () => {
    if (confirm("Clear every pick recorded for this league?")) dispatch({ type: "reset" });
  };
  return (
    <details class={styles.rescue}>
      <summary class={styles.summary}>Save or restore this draft</summary>
      <p class={shared.lede}>
        Picks save to this browser automatically. This code is the backup: copy it if you want to
        move to another device, or if the tab might get evicted.
      </p>
      <input
        class={styles.code}
        readOnly
        aria-label="Draft state code"
        value={encodeState(state)}
        onFocus={(event) => event.currentTarget.select()}
      />
      <p class={styles.actions}>
        <button class={styles.action} type="button" onClick={restore}>
          Restore from code
        </button>
        <button class={styles.action} type="button" onClick={reset}>
          Clear all picks
        </button>
      </p>
      {!storageAvailable() && (
        <p class={styles.warning}>
          <b>This browser is blocking storage.</b> Picks will hold for this session but not survive
          a reload. Copy the code above if you need to be safe.
        </p>
      )}
    </details>
  );
}

import styles from "./SlotPicker.module.css";

interface Props {
  /** 0 while unknown. */
  slot: number;
  setSlot: (next: number) => void;
  teams: number;
}

/** Shown only when the payload had no slot: the draft order wasn't out at build time. */
export function SlotPicker({ slot, setSlot, teams }: Props) {
  const options = Array.from({ length: teams }, (_, i) => i + 1);
  return (
    <>
      <label class={styles.picker}>
        Draft slot
        <select
          class={styles.select}
          aria-label="Your draft slot"
          value={slot || ""}
          onChange={(event) => setSlot(Number.parseInt(event.currentTarget.value, 10))}
        >
          <option value="">?</option>
          {options.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p class={styles.note}>
        Order isn't out yet. Set it here the moment ESPN reveals it. Live sync sets it automatically
        once the order or first picks appear.
      </p>
    </>
  );
}

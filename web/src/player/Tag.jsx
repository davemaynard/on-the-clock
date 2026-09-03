import styles from "./Tag.module.css";

/** The tag kinds the stylesheet knows. `alert` prints as "news"; see model/tags.js. */
export const TAG_KINDS = ["out", "target", "fade", "alert", "slp", "avoid", "stash"];

/**
 * A small filled label: a player's status or one of your calls. `title` carries the
 * full wording when the chip abbreviates it ("stash 160+" for a longer verdict).
 */
export function Tag({ kind, title, children }) {
  return (
    <span class={styles[kind] ?? styles.tag} title={title}>
      {children}
    </span>
  );
}

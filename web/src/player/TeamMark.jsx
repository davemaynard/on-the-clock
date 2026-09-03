import styles from "./TeamMark.module.css";

/** A club's mark, keyed by its three-letter code. Decorative: the team prints beside it. */
export function TeamMark({ team, className = "" }) {
  return <i class={`${styles.mark} ${className}`.trim()} data-team={team} aria-hidden="true" />;
}

import styles from "./StatRow.module.css";

/** The league in one line: size, your slot, rounds, bench, and the lineup it drafts. */
export function StatRow({ league, slot }) {
  return (
    <p class={styles.stats}>
      <span>
        <b>{league.teams}</b> teams
      </span>
      <span>
        slot <b>{slot || "TBD"}</b>
      </span>
      <span>
        <b>{league.roundsTotal}</b> rounds
      </span>
      <span>
        <b>{league.bench}</b> bench
      </span>
      <span class={styles.lineup}>
        {league.lineup.map(({ count, label }) => `${count}×${label}`).join(" · ")}
      </span>
    </p>
  );
}

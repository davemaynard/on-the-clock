import styles from "./Masthead.module.css";

export function Masthead({ year, leagueCount }: { year: number; leagueCount: number }) {
  return (
    <header class={styles.masthead}>
      <p class={styles.kicker}>{year} draft day</p>
      <h1>On the Clock</h1>
      <p class={styles.subtitle}>
        {leagueCount} {leagueCount === 1 ? "league" : "leagues"}, each board built from that
        league's own scoring and real lineup: superflex counts, flex counts, all of it. Tap players
        off as they go and everything recalculates against who is actually gone.
      </p>
    </header>
  );
}

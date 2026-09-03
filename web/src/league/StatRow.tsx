import type { League } from "../model/types.ts";
import styles from "./StatRow.module.css";

interface Props {
  league: Pick<League, "teams" | "roundsTotal" | "bench" | "lineup">;
  /** 0 while unknown. */
  slot: number;
}

/** The league in one line: size, your slot, rounds, bench, and the lineup it drafts. */
export function StatRow({ league, slot }: Props) {
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

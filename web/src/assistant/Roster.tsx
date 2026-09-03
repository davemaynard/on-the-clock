import type { Lineup } from "../model/model.ts";
import { TeamMark } from "../player/TeamMark.tsx";
import { cx } from "../styles/cx.ts";
import styles from "./Roster.module.css";

/** Your roster: every starting slot, filled or open, then the bench as one line. */
export function Roster({ lineup }: { lineup: Lineup }) {
  const { slots, bench } = lineup;
  return (
    <dl class={styles.roster} data-testid="roster">
      {slots.map(({ label, player }, i) => (
        <div
          key={`${label}-${i}`}
          class={cx(styles.slot, player && styles.filled)}
          data-state={player ? "filled" : "open"}
        >
          <dt class={styles.label}>{label}</dt>
          {player ? (
            <dd class={styles.player}>
              <TeamMark team={player.team} />
              {player.name}
            </dd>
          ) : (
            <dd class={cx(styles.player, styles.open)}>open</dd>
          )}
        </div>
      ))}
      {bench.length > 0 && (
        <div class={cx(styles.slot, styles.bench)}>
          <dt class={styles.label}>BENCH</dt>
          <dd class={styles.player}>{bench.map((p) => p.name).join(", ")}</dd>
        </div>
      )}
    </dl>
  );
}

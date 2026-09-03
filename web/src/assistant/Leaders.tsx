import { type Assessment, SKILL_POSITIONS } from "../model/model.ts";
import type { Player } from "../model/types.ts";
import { TeamMark } from "../player/TeamMark.tsx";
import styles from "./Leaders.module.css";

/** The best healthy player still available at each skill position. */
export function Leaders({ draft, players }: { draft: Assessment; players: Player[] }) {
  const leaders = SKILL_POSITIONS.flatMap((pos) => {
    const index = draft.ranked.find((i) => players[i].pos === pos && !players[i].out);
    return index === undefined ? [] : [{ pos, player: players[index] }];
  });
  return (
    <div class={styles.leaders}>
      {leaders.map(({ pos, player }) => (
        <div key={pos} class={styles.leader}>
          <span class={styles.pos}>{pos}</span>
          <span class={styles.name}>
            <TeamMark team={player.team} className={styles.mark} />
            {player.name}
          </span>
          <span class={styles.vor}>{Math.round(player.vor)}</span>
        </div>
      ))}
    </div>
  );
}

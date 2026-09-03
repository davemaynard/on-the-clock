import { SKILL_POSITIONS } from "../model/model.js";
import { TeamMark } from "../player/TeamMark.jsx";
import styles from "./Leaders.module.css";

/** The best healthy player still available at each skill position. */
export function Leaders({ draft, players }) {
  const leaders = SKILL_POSITIONS.map((pos) => ({
    pos,
    index: draft.ranked.find((i) => players[i].pos === pos && !players[i].out),
  })).filter(({ index }) => index !== undefined);
  return (
    <div class={styles.leaders}>
      {leaders.map(({ pos, index }) => (
        <div key={pos} class={styles.leader}>
          <span class={styles.pos}>{pos}</span>
          <span class={styles.name}>
            <TeamMark team={players[index].team} className={styles.mark} />
            {players[index].name}
          </span>
          <span class={styles.vor}>{Math.round(players[index].vor)}</span>
        </div>
      ))}
    </div>
  );
}

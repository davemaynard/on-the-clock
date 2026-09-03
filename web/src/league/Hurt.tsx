import { statusLabel } from "../model/tags.ts";
import type { HurtPlayer } from "../model/types.ts";
import { Tag } from "../player/Tag.tsx";
import styles from "./Hurt.module.css";

/** The top-150 players who are actually Out, Doubtful, on IR or suspended. */
export function Hurt({ players }: { players: HurtPlayer[] }) {
  if (!players.length) return null;
  return (
    <section class={styles.hurt}>
      <h3>Actually hurt</h3>
      <ol class={styles.list}>
        {players.map((player) => (
          <li key={player.name} class={styles.item}>
            <Tag kind="out">{statusLabel(player.status)}</Tag>
            {player.mark === "slp" && <Tag kind="slp">slp</Tag>}
            <span>{player.name}</span>
            <span class={styles.posRank}>
              {player.pos}
              {player.posRank}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

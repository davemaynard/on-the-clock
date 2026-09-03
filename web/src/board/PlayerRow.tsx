import type { Player } from "../model/types.ts";
import { PlayerName } from "../player/PlayerName.tsx";
import { cx } from "../styles/cx.ts";
import shared from "../styles/shared.module.css";
import styles from "./PlayerRow.module.css";

interface Props {
  player: Player;
  index: number;
  drafted: boolean;
  mine: boolean;
  /** One of the three best fits: a green rail. */
  recommended: boolean;
  /** Endgame, and his position can't be started: dimmed. */
  exhausted: boolean;
  score: number;
  fitMode: boolean;
  hidden: boolean;
  onClick: (event: MouseEvent, index: number) => void;
}

/**
 * One player on the board. Tapping anywhere marks him drafted (again to undo); his +
 * claims him for your roster; tapping the score flips the score mode. The row owns the
 * gesture and reads which control was hit from the target.
 */
export function PlayerRow({
  player,
  index,
  drafted,
  mine,
  recommended,
  exhausted,
  score,
  fitMode,
  hidden,
  onClick,
}: Props) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the name button inside carries the keyboard contract
    <li
      class={cx(
        styles.row,
        drafted && !mine && styles.drafted,
        mine && styles.mine,
        recommended && styles.recommended,
        exhausted && styles.exhausted,
        player.streamer && styles.streamer,
      )}
      hidden={hidden}
      onClick={(event) => onClick(event, index)}
    >
      <button
        class={cx(shared.claim, styles.claim)}
        type="button"
        data-claim
        aria-label={`Mark ${player.name} as mine`}
      >
        +
      </button>
      <PlayerName player={player} pressed={drafted} className={styles.name} />
      <span class={styles.pos}>
        {player.pos}
        {player.posRank}
      </span>
      <span class={styles.team}>{player.team}</span>
      {player.stub ? (
        // A stub (a marked name with no projection) shows a dash where the number would be.
        <span class={cx(styles.score, styles.dim)}>–</span>
      ) : (
        <span
          class={cx(styles.score, fitMode && styles.fit)}
          data-score
          title="Tap: VOR / fit score"
        >
          {Math.round(score)}
        </span>
      )}
      {player.why && <small class={styles.why}>{player.why}</small>}
    </li>
  );
}

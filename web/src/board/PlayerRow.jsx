import { PlayerName } from "../player/PlayerName.jsx";
import { cx } from "../styles/cx.js";
import shared from "../styles/shared.module.css";
import styles from "./PlayerRow.module.css";

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
}) {
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

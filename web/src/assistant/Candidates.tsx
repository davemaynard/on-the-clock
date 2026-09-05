import type { DraftDispatch } from "../league/useDraft.ts";
import type { Assessment } from "../model/model.ts";
import type { Player } from "../model/types.ts";
import { PlayerName } from "../player/PlayerName.tsx";
import { cx } from "../styles/cx.ts";
import shared from "../styles/shared.module.css";
import styles from "./Candidates.module.css";

const SHOWN = 6;

interface Props {
  draft: Assessment;
  players: Player[];
  score: (index: number) => number;
  fitMode: boolean;
  onToggleFit: () => void;
  dispatch: DraftDispatch;
}

/** Best available, ranked by fit, each with a bar for the chance he lasts to your pick. */
export function Candidates({ draft, players, score, fitMode, onToggleFit, dispatch }: Props) {
  // The list takes the same gestures as the board: tap marks him gone, his + makes him
  // yours, tapping the score flips the score mode.
  const onClick = (event: MouseEvent, index: number) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-score]")) {
      onToggleFit();
      return;
    }
    dispatch({ type: "draft", index, mine: Boolean(target.closest("[data-claim]")) });
  };
  return (
    <ol class={styles.candidates} aria-label="Best available">
      {draft.ranked.slice(0, SHOWN).map((index) => {
        const player = players[index];
        const chance = draft.chance(index);
        const likelihood =
          chance >= 0.7 ? styles.likely : chance >= 0.3 ? styles.maybe : styles.unlikely;
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the name button inside carries the keyboard contract
          <li
            key={index}
            class={cx(
              styles.candidate,
              likelihood,
              draft.recommended.has(index) && styles.recommended,
            )}
            title={player.why || undefined}
            onClick={(event) => onClick(event, index)}
          >
            <span class={styles.bar} style={{ "--chance": chance.toFixed(3) }} />
            <button
              class={shared.claim}
              type="button"
              data-claim
              aria-label={`Mark ${player.name} as mine`}
            >
              +
            </button>
            <span class={styles.chance}>{Math.round(chance * 100)}%</span>
            <PlayerName
              player={player}
              className={styles.player}
              detail={
                <span class={styles.posRank}>
                  {player.pos}
                  {player.posRank}
                </span>
              }
            />
            <span
              class={cx(styles.score, fitMode && styles.fit)}
              data-score
              title="Tap: VOR / fit score"
            >
              {Math.round(score(index))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

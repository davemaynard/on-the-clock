import { useStoredFlag } from "../league/useStored.js";
import { advice } from "../model/model.js";
import { storageKey } from "../model/storage.js";
import { cx } from "../styles/cx.js";
import shared from "../styles/shared.module.css";
import styles from "./Assistant.module.css";
import { Candidates } from "./Candidates.jsx";
import { Entry } from "./Entry.jsx";
import { Leaders } from "./Leaders.jsx";
import { SlotPicker } from "./SlotPicker.jsx";

/** What the clock says. */
export function clockLabel(league, draft) {
  if (league.done) return "Draft complete";
  if (draft.onClock) return "You're on the clock";
  if (draft.next === null) return league.picks.length ? "Draft complete" : "Slot TBD";
  return `${draft.picksAway} pick${draft.picksAway === 1 ? "" : "s"} away`;
}

/**
 * The panel that answers the draft-room questions: which pick is yours next, how far
 * away it is, what to shop for, who is best available and how likely he lasts. Sticky on
 * a phone, so it folds to one bar; the fold persists per league.
 */
export function Assistant({
  rootRef,
  league,
  players,
  state,
  draft,
  score,
  fitMode,
  onToggleFit,
  slotPicker,
  badge,
  dispatch,
}) {
  const [folded, setFolded] = useStoredFlag(storageKey(league.key, "folded"));
  const toggleFold = () => setFolded(!folded);
  const said = advice(league, draft);
  const nextPick = league.done || draft.next === null ? "–" : draft.next;

  return (
    <section
      ref={rootRef}
      class={cx(styles.assistant, folded && styles.folded)}
      aria-label="Draft assistant"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the fold button carries the keyboard contract; the whole head is the thumb target */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same */}
      <div
        class={styles.head}
        onClick={(event) => {
          if (!event.target.closest("button")) toggleFold();
        }}
      >
        <div class={styles.next}>
          <p class={shared.label}>Your next pick</p>
          <p class={styles.nextPick} data-testid="next-pick">
            {nextPick}
          </p>
        </div>
        <div class={styles.status}>
          <p
            class={cx(styles.clock, draft.onClock && !league.done && styles.live)}
            data-testid="clock"
          >
            {clockLabel(league, draft)}
          </p>
          <p class={styles.draftedCount} data-testid="drafted-count">
            {draft.drafted} off the board
          </p>
          {badge.text && (
            <p class={styles.badge} data-state={badge.state}>
              {badge.text}
            </p>
          )}
        </div>
        <button
          class={styles.fold}
          type="button"
          aria-expanded={!folded}
          aria-label={folded ? "Expand draft assistant" : "Collapse draft assistant"}
          onClick={toggleFold}
        />
      </div>

      <p class={styles.advice} aria-live="polite">
        {said && (
          <>
            {said.before}
            <b class={styles.focus}>{said.focus}</b>
            {said.after}
          </>
        )}
      </p>

      <div class={styles.body}>
        {slotPicker && <SlotPicker {...slotPicker} />}
        <Entry offBoard={state.offBoard} canUndo={state.history.length > 0} dispatch={dispatch} />
        <p class={shared.label}>Best available · chance he lasts</p>
        <Candidates
          draft={draft}
          players={players}
          score={score}
          fitMode={fitMode}
          onToggleFit={onToggleFit}
          dispatch={dispatch}
        />
        <Leaders draft={draft} players={players} />
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import { Assistant } from "../assistant/Assistant.jsx";
import { Roster } from "../assistant/Roster.jsx";
import { Board } from "../board/Board.jsx";
import { Rescue } from "../board/Rescue.jsx";
import { assess, fillLineup } from "../model/model.js";
import { storageKey } from "../model/storage.js";
import shared from "../styles/shared.module.css";
import { Hurt } from "./Hurt.jsx";
import styles from "./LeaguePanel.module.css";
import { Plan } from "./Plan.jsx";
import { StatRow } from "./StatRow.jsx";
import { useDraft } from "./useDraft.js";
import { useLiveSync } from "./useLiveSync.js";
import { useSlot, useStoredFlag } from "./useStored.js";
import { WaitingCosts } from "./WaitingCosts.jsx";

/**
 * One league's draft room. Owns the state (what's gone, what's yours), derives the
 * assessment fresh on every render, and lays the pieces out: a rail with the plan, the
 * assistant and your roster; the board; and the pre-draft tables across the bottom.
 */
export function LeaguePanel({ league, live, active }) {
  const players = league.players;
  const [state, dispatch] = useDraft(league.key);
  const { slot, setSlot, picks } = useSlot(league);
  const feed = useLiveSync({ enabled: live, league, players, slot, setSlot, state, dispatch });

  // Score display: VOR (the market's number) or fit (VOR plus the roster-need bonus, the
  // number the green rails rank by).
  const [fitMode, setFitMode] = useStoredFlag(storageKey(league.key, "fit"));
  const toggleFitMode = useCallback(() => setFitMode(!fitMode), [fitMode, setFitMode]);

  const view = useMemo(
    () => ({ ...league, slot, picks, feedOffBoard: feed.offBoard, done: feed.done }),
    [league, slot, picks, feed.offBoard, feed.done],
  );
  const draft = assess(view, players, state);
  const score = (index) => (fitMode ? draft.fit(index) : players[index].vor);
  const lineup = fillLineup(view, players, state.mine);

  // The assistant is sticky on a phone and the tools bar sticks just below it, reading
  // the panel's live height from --assistant-height.
  const panel = useRef(null);
  const assistant = useRef(null);
  useEffect(() => {
    if (!window.ResizeObserver || !assistant.current) return undefined;
    const observer = new ResizeObserver(() => {
      panel.current?.style.setProperty("--assistant-height", `${assistant.current.offsetHeight}px`);
    });
    observer.observe(assistant.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={panel}
      class={styles.panel}
      id={`league-${league.index}`}
      role="tabpanel"
      aria-labelledby={`tab${league.index}`}
      hidden={!active}
    >
      <div class={styles.rail} data-testid="rail">
        <StatRow league={league} slot={slot} />
        <Plan principles={league.principles} script={league.script} />
        <div class={styles.railSticky} data-testid="rail-sticky">
          <Assistant
            rootRef={assistant}
            league={view}
            players={players}
            state={state}
            draft={draft}
            score={score}
            fitMode={fitMode}
            onToggleFit={toggleFitMode}
            slotPicker={league.slot ? null : { slot, setSlot, teams: league.teams }}
            badge={feed.badge}
            dispatch={dispatch}
          />
          <h2>Your roster</h2>
          <Roster lineup={lineup} />
        </div>
      </div>

      <div class={styles.board} data-testid="board-column">
        <h2>The board</h2>
        <p class={shared.lede}>
          Tap a player the moment he's taken. Tap again to undo. <b>+</b> marks him as yours.
          Everything above recalculates from what's actually gone, which is the part a checklist
          can't do.
        </p>
        <Board
          players={players}
          state={state}
          draft={draft}
          score={score}
          fitMode={fitMode}
          onToggleFit={toggleFitMode}
          dispatch={dispatch}
        />
        <Rescue state={state} dispatch={dispatch} />
      </div>

      <div class={styles.wide}>
        <WaitingCosts picks={league.picks} curve={league.curve} />
        <Hurt players={league.hurt} />
      </div>
    </section>
  );
}

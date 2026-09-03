import type { RefObject } from "preact";
import shared from "../styles/shared.module.css";
import styles from "./Tools.module.css";

/** The position filters: every position, all of them, or the flex-eligible three. */
export type Filter = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLX" | "K" | "DST";

const FILTERS: Filter[] = ["ALL", "QB", "RB", "WR", "TE", "FLX", "K", "DST"];

interface Props {
  searchRef: RefObject<HTMLInputElement>;
  query: string;
  onQuery: (query: string) => void;
  onSearchKeyDown: (event: KeyboardEvent) => void;
  pos: Filter;
  onPos: (filter: Filter) => void;
  /** Endgame: a position whose slots are all filled, and no flex can take it. */
  isMuted: (filter: Filter) => boolean;
  hideDrafted: boolean;
  onHideDrafted: (hide: boolean) => void;
  fitMode: boolean;
  onToggleFit: () => void;
  canUndo: boolean;
  onUndo: () => void;
}

/** Search, position filters, the drafted toggle, the score mode, and undo. */
export function Tools({
  searchRef,
  query,
  onQuery,
  onSearchKeyDown,
  pos,
  onPos,
  isMuted,
  hideDrafted,
  onHideDrafted,
  fitMode,
  onToggleFit,
  canUndo,
  onUndo,
}: Props) {
  return (
    <div class={styles.tools} data-testid="tools">
      <input
        ref={searchRef}
        class={styles.search}
        type="search"
        placeholder="Search player or team"
        aria-label="Search players"
        value={query}
        onInput={(event) => onQuery(event.currentTarget.value)}
        onKeyDown={onSearchKeyDown}
      />
      <div class={styles.filters}>
        {FILTERS.map((filter) => (
          <button
            key={filter}
            class={`${styles.filter} ${isMuted(filter) ? styles.muted : ""}`.trim()}
            type="button"
            aria-pressed={filter === pos}
            onClick={() => onPos(filter)}
          >
            {filter}
          </button>
        ))}
      </div>
      <label class={styles.toggle}>
        <input
          type="checkbox"
          checked={hideDrafted}
          onChange={(event) => onHideDrafted(event.currentTarget.checked)}
        />
        Hide drafted
      </label>
      {/* Score display: VOR is the market's number; fit adds the roster-need bonus, the
          number the green rails rank by. Tapping any score on the board flips it too. */}
      <fieldset class={styles.modes}>
        <legend class={shared.visuallyHidden}>Score shown</legend>
        <button
          class={styles.mode}
          type="button"
          aria-pressed={!fitMode}
          title="Value over replacement"
          onClick={() => fitMode && onToggleFit()}
        >
          VOR
        </button>
        <button
          class={styles.mode}
          type="button"
          aria-pressed={fitMode}
          title="VOR plus what waiting at that position costs your roster"
          onClick={() => !fitMode && onToggleFit()}
        >
          Fit
        </button>
      </fieldset>
      <button class={styles.undo} type="button" disabled={!canUndo} onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}

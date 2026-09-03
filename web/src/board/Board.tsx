import { useRef, useState } from "preact/hooks";
import type { DraftDispatch, DraftHistoryState } from "../league/useDraft.ts";
import { type Assessment, SKILL_POSITIONS } from "../model/model.ts";
import type { Player, Position } from "../model/types.ts";
import styles from "./Board.module.css";
import { PlayerRow } from "./PlayerRow.tsx";
import { type Filter, Tools } from "./Tools.tsx";

const FLEX_POSITIONS: Position[] = ["RB", "WR", "TE"];

interface Props {
  players: Player[];
  state: DraftHistoryState;
  draft: Assessment;
  score: (index: number) => number;
  fitMode: boolean;
  onToggleFit: () => void;
  dispatch: DraftDispatch;
}

/**
 * Every player on the board, in VOR order, with the tools that narrow it. The filters
 * are per-viewer and never saved: a fresh page shows the whole board.
 */
export function Board({ players, state, draft, score, fitMode, onToggleFit, dispatch }: Props) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<Filter>("ALL");
  const [hideDrafted, setHideDrafted] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const needle = query.trim().toLowerCase();
  const visible = (index: number): boolean => {
    const player = players[index];
    const matchesText =
      !needle ||
      player.name.toLowerCase().includes(needle) ||
      player.team.toLowerCase().includes(needle);
    const matchesPos =
      pos === "ALL" || player.pos === pos || (pos === "FLX" && FLEX_POSITIONS.includes(player.pos));
    const matchesDrafted = !hideDrafted || !state.drafted.has(index);
    return matchesText && matchesPos && matchesDrafted;
  };

  // Typing the next name is the bottleneck when every pick is entered by hand, so a
  // search that marked someone clears itself and keeps focus.
  const afterMark = () => {
    if (!query) return;
    setQuery("");
    search.current?.focus();
  };
  const onRowClick = (event: MouseEvent, index: number) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-score]")) {
      onToggleFit();
      return;
    }
    dispatch({ type: target.closest("[data-claim]") ? "claim" : "tap", index });
    afterMark();
  };
  // Enter marks the first remaining match: no aiming at a row on a moving list.
  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    const first = players.findIndex((_, i) => visible(i) && !state.drafted.has(i));
    if (first < 0) return;
    event.preventDefault();
    dispatch({ type: "tap", index: first });
    setQuery("");
  };

  return (
    <>
      <Tools
        searchRef={search}
        query={query}
        onQuery={setQuery}
        onSearchKeyDown={onSearchKeyDown}
        pos={pos}
        onPos={setPos}
        isMuted={(p) =>
          draft.endgame &&
          (SKILL_POSITIONS as string[]).includes(p) &&
          draft.exhausted(p as Position)
        }
        hideDrafted={hideDrafted}
        onHideDrafted={setHideDrafted}
        fitMode={fitMode}
        onToggleFit={onToggleFit}
        canUndo={state.history.length > 0}
        onUndo={() => dispatch({ type: "undo" })}
      />
      <ol class={styles.board} aria-label="The board" data-testid="board">
        {players.map((player, index) => (
          <PlayerRow
            key={index}
            player={player}
            index={index}
            drafted={state.drafted.has(index)}
            mine={state.mine.has(index)}
            recommended={draft.recommended.has(index)}
            exhausted={draft.endgame && draft.exhausted(player.pos)}
            score={score(index)}
            fitMode={fitMode}
            hidden={!visible(index)}
            onClick={onRowClick}
          />
        ))}
      </ol>
    </>
  );
}

import { useRef } from "preact/hooks";
import type { League } from "../model/types.ts";
import styles from "./LeagueTabs.module.css";

interface Props {
  leagues: League[];
  active: number;
  onSelect: (index: number) => void;
}

const ARROW_STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: () => 1,
  ArrowLeft: () => -1,
  Home: (index) => -index,
  End: (index, count) => count - 1 - index,
};

/**
 * One tab per league, with the keyboard contract the tab role promises: a roving
 * tabindex, arrows to move, Home and End to jump.
 */
export function LeagueTabs({ leagues, active, onSelect }: Props) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = ARROW_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step(index, leagues.length) + leagues.length) % leagues.length;
    onSelect(next);
    buttons.current[next]?.focus();
  };
  return (
    <div class={styles.tabs} role="tablist" aria-label="League">
      {leagues.map((league, index) => (
        <button
          key={league.key}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          class={styles.tab}
          type="button"
          role="tab"
          id={`tab${index}`}
          aria-selected={index === active}
          aria-controls={`league-${index}`}
          tabIndex={index === active ? 0 : -1}
          onClick={() => onSelect(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {league.name}
        </button>
      ))}
    </div>
  );
}

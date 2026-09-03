import { useRef } from "preact/hooks";
import styles from "./LeagueTabs.module.css";

/**
 * One tab per league, with the keyboard contract the tab role promises: a roving
 * tabindex, arrows to move, Home and End to jump.
 */
export function LeagueTabs({ leagues, active, onSelect }) {
  const buttons = useRef([]);
  const move = (from, step) => {
    const next = (from + step + leagues.length) % leagues.length;
    onSelect(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (event, index) => {
    const step = {
      ArrowRight: 1,
      ArrowLeft: -1,
      Home: -index,
      End: leagues.length - 1 - index,
    }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    move(index, step);
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

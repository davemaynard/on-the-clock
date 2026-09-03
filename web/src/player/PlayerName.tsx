import type { ComponentChildren } from "preact";
import { playerTags } from "../model/tags.ts";
import type { Player } from "../model/types.ts";
import styles from "./PlayerName.module.css";
import { Tag } from "./Tag.tsx";
import { TeamMark } from "./TeamMark.tsx";

interface Props {
  player: Player;
  /** The drafted state, told through the button. */
  pressed?: boolean;
  /** Something small between the name and the tags: the candidate list puts his rank there. */
  detail?: ComponentChildren;
  className?: string;
}

/**
 * A player's name as the button that drafts him, with his team mark in front and his
 * tags after. `pressed` is the drafted state, so the button tells the truth to a screen
 * reader without a second control. Tapping bubbles to the row, which owns the gesture.
 */
export function PlayerName({ player, pressed = false, detail = null, className = "" }: Props) {
  return (
    <span class={`${styles.name} ${className}`.trim()}>
      <button class={styles.toggle} type="button" aria-pressed={pressed}>
        <TeamMark team={player.team} />
        {player.name}
      </button>
      {detail}
      {playerTags(player).map((tag) => (
        <Tag key={tag.kind} kind={tag.kind} title={tag.title}>
          {tag.text}
        </Tag>
      ))}
    </span>
  );
}

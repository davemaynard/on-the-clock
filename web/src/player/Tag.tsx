import type { ComponentChildren } from "preact";
import type { TagKind } from "../model/tags.ts";
import styles from "./Tag.module.css";

interface Props {
  kind: TagKind;
  /** The full wording when the chip abbreviates it ("stash 160+" for a longer verdict). */
  title?: string;
  children: ComponentChildren;
}

/** A small filled label: a player's status or one of your calls. */
export function Tag({ kind, title, children }: Props) {
  return (
    <span class={styles[kind]} title={title}>
      {children}
    </span>
  );
}

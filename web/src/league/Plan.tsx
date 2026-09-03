import type { TagKind } from "../model/tags.ts";
import type { ScriptStep } from "../model/types.ts";
import { Tag } from "../player/Tag.tsx";
import shared from "../styles/shared.module.css";
import styles from "./Plan.module.css";

/** What each tag on the board means, in the order they matter on draft night. */
const LEGEND: Array<{ kind: TagKind; text: string; meaning: string }> = [
  { kind: "target", text: "target", meaning: "Take at price." },
  { kind: "fade", text: "fade", meaning: "Not at that price." },
  { kind: "alert", text: "news", meaning: "This week's news, not yet in ESPN's number." },
  { kind: "avoid", text: "avoid", meaning: "Repriced. Do not draft." },
  { kind: "stash", text: "stash 160+", meaning: "Repriced. Only at the stated price or pick." },
  {
    kind: "slp",
    text: "slp",
    meaning: "Hurt sleeper: Out today, still worth a late pick for the IR slot.",
  },
];

interface Props {
  principles: string[];
  script: ScriptStep[];
}

/**
 * Your thesis for the league and the round-by-round script, from marks.toml, with the
 * legend for the tags the board shows. Collapsed by default: read before the draft,
 * out of the way during it.
 */
export function Plan({ principles, script }: Props) {
  if (!principles.length) return null;
  return (
    <details class={styles.plan}>
      <summary class={styles.summary}>The plan: thesis and pick script</summary>
      <ul class={styles.principles}>
        {principles.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {script.length > 0 && (
        <ol class={styles.script}>
          {script.map(({ round, pick, text }) => (
            <li key={round} class={styles.step}>
              <span class={styles.round}>R{round}</span>
              <span class={styles.pick}>@{pick}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      )}
      <div class={styles.legend}>
        <p class={shared.label}>On the board</p>
        <dl class={styles.legendList}>
          {LEGEND.map(({ kind, text, meaning }) => (
            <div key={kind} class={styles.legendRow}>
              <dt>
                <Tag kind={kind}>{text}</Tag>
              </dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
        <p class={styles.legendNote}>The one-line why sits under each name.</p>
      </div>
    </details>
  );
}

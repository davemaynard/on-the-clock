// The tags a player carries: his status, or one of your calls from marks.toml. Pure text
// decisions, so the row and the candidate list agree and the rules can be tested.
import type { Player } from "./types.ts";

/** The tag kinds the stylesheet knows. */
export type TagKind = "out" | "target" | "fade" | "alert" | "slp" | "avoid" | "stash";

export interface PlayerTag {
  kind: TagKind;
  text: string;
  /** The full wording when the chip abbreviates it. */
  title?: string;
}

// ESPN's status enums are database values, not labels. "Injury_Reserve" on a chip is
// both plumbing showing through and the widest thing in the row.
const STATUS_LABEL: Record<string, string> = {
  OUT: "out",
  DOUBTFUL: "doubtful",
  INJURY_RESERVE: "IR",
  SUSPENSION: "susp",
};

/** A status enum as a short chip label. */
export function statusLabel(status: string): string {
  if (!status) return "";
  return STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase();
}

/**
 * The chip form of a verdict. A phone row is about 12rem of shared space for name and
 * chip, so "WAIT FOR PRICE" truncated the name to "Micha…". Keep the leading word, plus
 * a following number when it carries the instruction ("STASH 160+"); the full sentence
 * still shows in the why-line and the chip's title.
 */
export function verdictTag(verdict: string): string {
  const words = verdict.split(/\s+/).filter(Boolean);
  if (!words.length) return verdict;
  // "DO NOT DRAFT" must not abbreviate to "DO"; a number is the instruction ("STASH
  // 160+"), so it comes along too.
  const keepSecond = words.length > 1 && (words[0].length < 4 || /\d/.test(words[1]));
  return keepSecond ? `${words[0]} ${words[1]}` : words[0];
}

/** A hard no reads urgent; a price-conditional verdict reads calm. */
export const verdictKind = (verdict: string): TagKind =>
  verdict.startsWith("AVOID") || verdict.startsWith("DO NOT") ? "avoid" : "stash";

/** The fields of a player the tags are decided from. */
export type Taggable = Pick<Player, "out" | "verdict" | "mark"> & { status?: string };

/**
 * The tags one player shows, in order. Status and verdict together ("out" + "do not
 * draft") say one thing twice and cost the name its room; the verdict tells you what
 * to DO, so when both apply it stands alone.
 */
export function playerTags(player: Taggable): PlayerTag[] {
  const tags: PlayerTag[] = [];
  if (player.out && !player.verdict) {
    tags.push({ kind: "out", text: statusLabel(player.status ?? "") || "out" });
  }
  if (player.verdict) {
    const text = verdictTag(player.verdict);
    tags.push({
      kind: verdictKind(player.verdict),
      text: text.toLowerCase(),
      title: text === player.verdict ? undefined : player.verdict,
    });
  } else if (player.mark) {
    tags.push({ kind: player.mark, text: player.mark === "alert" ? "news" : player.mark });
  }
  return tags;
}

// HTML for the parts the tracker redraws. Strings in, strings out; the league
// controller decides when and where they land.

const escapeAttr = (text) => String(text).replace(/"/g, "&quot;");

const teamMark = (team) => `<i class="team-mark team-mark-${team}" aria-hidden="true"></i>`;

/** The status or verdict tag a player carries, if any. */
export function playerTag(player) {
  const out = player.out ? '<span class="tag tag-out">out</span>' : "";
  if (player.verdict) {
    const kind =
      player.verdict.startsWith("AVOID") || player.verdict.startsWith("DO NOT") ? "avoid" : "stash";
    return `${out}<span class="tag tag-${kind}">${player.verdict.toLowerCase()}</span>`;
  }
  if (player.mark) {
    const word = player.mark === "alert" ? "news" : player.mark;
    return `${out}<span class="tag tag-${player.mark}">${word}</span>`;
  }
  return out;
}

/** What the clock says. */
export function clockLabel(league, assessment) {
  if (league.done) return "Draft complete";
  if (assessment.onClock) return "You're on the clock";
  if (assessment.next === null) return league.picks.length ? "Draft complete" : "Slot TBD";
  const away = assessment.picksAway;
  return `${away} pick${away === 1 ? "" : "s"} away`;
}

/** One best-available candidate. */
export function candidateItem({ index, player, chance, score }) {
  const likelihood = chance >= 0.7 ? "is-likely" : chance >= 0.3 ? "is-maybe" : "is-unlikely";
  const title = player.why ? ` title="${escapeAttr(player.why)}"` : "";
  return `<li class="candidate ${likelihood}" data-index="${index}"${title}>
    <span class="chance-bar" style="--chance:${chance.toFixed(3)}"></span>
    <button class="mine-button" type="button" aria-label="Mark ${escapeAttr(player.name)} as mine">+</button>
    <span class="chance">${Math.round(chance * 100)}%</span>
    <span class="candidate-name">${teamMark(player.team)}${player.name}<span class="pos-rank">${player.pos}${player.posRank}</span>${playerTag(player)}</span>
    <span class="candidate-vor" title="Tap: VOR / fit score">${Math.round(score)}</span></li>`;
}

/** The best still available at one position. */
export function leaderItem(pos, player) {
  return `<div class="leader"><span class="leader-pos">${pos}</span>
    <span class="leader-name">${teamMark(player.team)}${player.name}</span>
    <span class="leader-vor">${Math.round(player.vor)}</span></div>`;
}

/** The roster: every starting slot, filled or open, then the bench. */
export function rosterHtml({ slots, bench }) {
  const slotHtml = slots
    .map(
      ({ label, player }) =>
        `<div class="slot${player ? " is-filled" : ""}"><span class="slot-label">${label}</span>
       <span class="slot-player${player ? "" : " is-open"}">${
         player ? `${teamMark(player.team)}${player.name}` : "open"
}</span></div>`,
    )
    .join("");
  const benchHtml = bench.length
    ? `<div class="slot is-bench"><span class="slot-label">BENCH</span>
         <span class="slot-player">${bench.map((p) => p.name).join(", ")}</span></div>`
    : "";
  return slotHtml + benchHtml;
}

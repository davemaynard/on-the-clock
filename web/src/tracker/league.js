// One league's tracker: the state, its persistence and undo history, and the wiring
// between the page and the model. Everything derived is recomputed on every render.
import { startLiveSync } from "./live.js";
import { advice, assess, fillLineup, SKILL_POSITIONS, snakePicks } from "./model.js";
import { decodeState, encodeState } from "./rescue.js";
import { read, readJson, storageAvailable, storageKey, write, writeJson } from "./storage.js";
import { candidateItem, clockLabel, leaderItem, rosterHtml } from "./view.js";

const HISTORY_LIMIT = 40;

const query = (selector, root) => root.querySelector(selector);
const queryAll = (selector, root) => [...root.querySelectorAll(selector)];

/** The saved state for a league: drafted and mine as index sets, plus off-board picks. */
function loadState(key) {
  const saved = readJson(key, null) || {};
  const drafted = new Set(saved.drafted || []);
  const mine = new Set(saved.mine || []);
  for (const i of mine) drafted.add(i);
  return { drafted, mine, offBoard: saved.offBoard || 0 };
}

const saveState = (key, state) =>
  writeJson(key, {
    drafted: [...state.drafted],
    mine: [...state.mine],
    offBoard: state.offBoard || 0,
  });

export function mountLeague(league, live) {
  const root = document.getElementById(`league-${league.index}`);
  const players = league.players;
  const key = storageKey(league.key);
  const state = loadState(key);

  const els = {
    nextPick: query(".next-pick", root),
    clock: query(".clock", root),
    draftedCount: query(".drafted-count", root),
    advice: query(".advice", root),
    candidates: query(".candidates", root),
    leaders: query(".leaders", root),
    roster: query(".roster", root),
    board: query(".board-list", root),
    search: query(".search", root),
    filters: queryAll(".pos-filter", root),
    hideDrafted: query(".hide-drafted", root),
    stateCode: query(".state-code", root),
    storageNote: query(".storage-note", root),
    offBoardCount: query(".offboard-count", root),
    undos: queryAll(".undo", root),
    assistant: query(".assistant", root),
    fold: query(".assistant-fold", root),
    slotSelect: query(".slot-select", root),
    slotStat: query(".slot-stat", root),
    liveBadge: query(".live-badge", root),
  };
  const rows = new Map(queryAll(".row", els.board).map((el) => [Number(el.dataset.index), el]));

  /* ---- the draft slot -------------------------------------------------------------- */
  // The slot may be unknown until an hour before the draft (random order). Sources,
  // in trust order: the payload (rebuilt after the reveal), a slot saved in this
  // browser, the ESPN feed, the picker. Once set from any source the feed never
  // overwrites it: a human correction must stick.
  const slotKey = storageKey(league.key, "slot");
  const setSlot = (slot) => {
    league.slot = slot;
    league.picks = snakePicks(slot, league.teams, league.roundsTotal);
    if (els.slotStat) els.slotStat.textContent = slot;
    if (els.slotSelect) els.slotSelect.value = String(slot);
    write(slotKey, String(slot));
  };
  if (!league.slot) {
    const saved = Number.parseInt(read(slotKey) || "", 10);
    if (saved >= 1 && saved <= league.teams) setSlot(saved);
  }
  els.slotSelect?.addEventListener("change", () => {
    const slot = Number.parseInt(els.slotSelect.value, 10);
    if (slot >= 1 && slot <= league.teams) {
      setSlot(slot);
      refresh();
    }
  });

  /* ---- undo history ---------------------------------------------------------------- */
  // Manual entry needs a way back: every change pushes a snapshot and Undo pops it.
  // The stack survives a refresh; snapshots are plain index arrays, so forty of them
  // are a few kilobytes.
  const historyKey = storageKey(league.key, "history");
  const history = (readJson(historyKey, null) || []).map((h) => ({
    drafted: new Set(h.drafted),
    mine: new Set(h.mine),
    offBoard: h.offBoard || 0,
  }));
  const saveHistory = () =>
    writeJson(
      historyKey,
      history.map((h) => ({ drafted: [...h.drafted], mine: [...h.mine], offBoard: h.offBoard })),
    );
  const syncUndoButtons = () => {
    for (const button of els.undos) button.disabled = !history.length;
  };
  const snapshot = () => {
    history.push({
      drafted: new Set(state.drafted),
      mine: new Set(state.mine),
      offBoard: state.offBoard || 0,
    });
    if (history.length > HISTORY_LIMIT) history.shift();
    saveHistory();
    syncUndoButtons();
  };
  const undo = () => {
    const previous = history.pop();
    if (!previous) return;
    state.drafted = previous.drafted;
    state.mine = previous.mine;
    state.offBoard = previous.offBoard;
    saveHistory();
    syncUndoButtons();
    refresh();
  };
  syncUndoButtons();

  /* ---- per-viewer preferences ------------------------------------------------------ */
  // The assistant is sticky, and on a phone the expanded panel is half the screen, so
  // the fold persists per league. The tools bar sticks just below whatever height the
  // panel has, via --assistant-height.
  const foldKey = storageKey(league.key, "folded");
  const setFolded = (folded) => {
    els.assistant.classList.toggle("is-folded", folded);
    els.fold.setAttribute("aria-expanded", String(!folded));
    els.fold.setAttribute(
      "aria-label",
      folded ? "Expand draft assistant" : "Collapse draft assistant",
    );
    write(foldKey, folded ? "1" : "0");
  };
  const toggleFold = () => setFolded(!els.assistant.classList.contains("is-folded"));
  setFolded(read(foldKey) === "1");
  els.fold.addEventListener("click", toggleFold);
  query(".assistant-head", root).addEventListener("click", (event) => {
    if (!event.target.closest("button")) toggleFold();
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      root.style.setProperty("--assistant-height", `${els.assistant.offsetHeight}px`);
    }).observe(els.assistant);
  }

  // Score display: VOR (the market's number) or fit (VOR plus the roster-need bonus,
  // the number the green rails rank by). Tapping any score flips it.
  const fitKey = storageKey(league.key, "fit");
  let fitMode = read(fitKey) === "1";
  const toggleFitMode = () => {
    fitMode = !fitMode;
    write(fitKey, fitMode ? "1" : "0");
    render();
  };

  /* ---- render ---------------------------------------------------------------------- */
  function render() {
    const draft = assess(league, players, state);
    const score = (i) => (fitMode ? draft.fit(i) : players[i].vor);

    els.nextPick.textContent = league.done || draft.next === null ? "–" : draft.next;
    els.clock.textContent = clockLabel(league, draft);
    els.clock.classList.toggle("is-live", draft.onClock && !league.done);
    els.draftedCount.textContent = `${draft.drafted} off the board`;
    els.offBoardCount.textContent = state.offBoard ? `${state.offBoard} unlisted` : "";
    els.advice.innerHTML = advice(league, draft);

    els.candidates.innerHTML = draft.ranked
      .slice(0, 6)
      .map((i) =>
        candidateItem({ index: i, player: players[i], chance: draft.chance(i), score: score(i) }),
      )
      .join("");
    els.leaders.innerHTML = SKILL_POSITIONS.map((pos) => {
      const i = draft.ranked.find((j) => players[j].pos === pos && !players[j].out);
      return i === undefined ? "" : leaderItem(pos, players[i]);
    }).join("");
    els.roster.innerHTML = rosterHtml(fillLineup(league, players, state.mine));

    root.classList.toggle("is-fit-mode", fitMode);
    for (const [i, row] of rows) {
      query(".row-toggle", row).setAttribute("aria-pressed", String(state.drafted.has(i)));
      row.classList.toggle("is-drafted", state.drafted.has(i) && !state.mine.has(i));
      row.classList.toggle("is-mine", state.mine.has(i));
      row.classList.toggle("is-recommended", draft.recommended.has(i));
      row.classList.toggle("is-exhausted", draft.endgame && draft.exhausted(players[i].pos));
      // Stubs (marked names with no projection) keep their dash; every scored row,
      // K and DST included, follows the score mode.
      if (!players[i].stub) query(".row-vor", row).textContent = Math.round(score(i));
    }
    for (const button of els.filters) {
      const pos = button.dataset.pos;
      button.classList.toggle(
        "is-muted",
        draft.endgame && SKILL_POSITIONS.includes(pos) && draft.exhausted(pos),
      );
    }
    els.stateCode.value = encodeState(state);
    saveState(key, state);
  }

  const applyFilter = () => {
    const needle = els.search.value.trim().toLowerCase();
    const pos = query(".pos-filter.is-on", root)?.dataset.pos || "ALL";
    const hideDrafted = els.hideDrafted.checked;
    for (const [i, row] of rows) {
      const player = players[i];
      const matchesText =
        !needle ||
        player.name.toLowerCase().includes(needle) ||
        player.team.toLowerCase().includes(needle);
      const matchesPos =
        pos === "ALL" ||
        player.pos === pos ||
        (pos === "FLX" && ["RB", "WR", "TE"].includes(player.pos));
      const matchesDrafted = !hideDrafted || !state.drafted.has(i);
      row.hidden = !(matchesText && matchesPos && matchesDrafted);
    }
  };
  const refresh = () => {
    render();
    applyFilter();
  };

  /* ---- gestures -------------------------------------------------------------------- */
  // Tapping a row marks the player drafted; tapping again undoes it; his + claims him
  // for your roster. Tapping a score flips the score mode.
  els.board.addEventListener("click", (event) => {
    if (event.target.closest(".row-vor")) {
      toggleFitMode();
      return;
    }
    const row = event.target.closest(".row");
    if (!row) return;
    snapshot();
    const i = Number(row.dataset.index);
    if (event.target.closest(".mine-button")) {
      if (state.mine.has(i)) {
        state.mine.delete(i);
        state.drafted.delete(i);
      } else {
        state.mine.add(i);
        state.drafted.add(i);
      }
    } else if (state.drafted.has(i)) {
      state.drafted.delete(i);
      state.mine.delete(i);
    } else {
      state.drafted.add(i);
    }
    // Typing the next name is the bottleneck when every pick is entered by hand, so a
    // search that marked someone clears itself and keeps focus.
    if (els.search.value) {
      els.search.value = "";
      els.search.focus();
    }
    refresh();
  });

  // The best-available list takes the same gestures as the board.
  els.candidates.addEventListener("click", (event) => {
    if (event.target.closest(".candidate-vor")) {
      toggleFitMode();
      return;
    }
    const item = event.target.closest(".candidate");
    if (!item) return;
    snapshot();
    const i = Number(item.dataset.index);
    state.drafted.add(i);
    if (event.target.closest(".mine-button")) state.mine.add(i);
    refresh();
  });

  // Enter marks the first remaining match: no aiming at a row on a moving list.
  els.search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const visible = [...rows.entries()].filter(([i, row]) => !row.hidden && !state.drafted.has(i));
    if (!visible.length) return;
    event.preventDefault();
    snapshot();
    state.drafted.add(visible[0][0]);
    els.search.value = "";
    refresh();
  });
  els.search.addEventListener("input", applyFilter);
  els.hideDrafted.addEventListener("change", applyFilter);
  for (const button of els.filters) {
    button.addEventListener("click", () => {
      for (const other of els.filters) other.classList.toggle("is-on", other === button);
      applyFilter();
    });
  }

  const bumpOffBoard = (delta) => {
    const next = Math.max(0, (state.offBoard || 0) + delta);
    if (next === state.offBoard) return;
    snapshot();
    state.offBoard = next;
    render();
  };
  query(".offboard-add", root).addEventListener("click", () => bumpOffBoard(1));
  query(".offboard-remove", root).addEventListener("click", () => bumpOffBoard(-1));
  for (const button of els.undos) button.addEventListener("click", undo);

  // Native dialogs on purpose: two actions a year, and they work offline on every phone.
  query(".restore", root).addEventListener("click", () => {
    const code = prompt("Paste a saved draft code:");
    if (!code) return;
    snapshot();
    const next = decodeState(code);
    state.drafted = next.drafted;
    state.mine = next.mine;
    state.offBoard = next.offBoard;
    for (const i of state.mine) state.drafted.add(i);
    refresh();
  });
  query(".reset", root).addEventListener("click", () => {
    if (!confirm("Clear every pick recorded for this league?")) return;
    snapshot();
    state.drafted.clear();
    state.mine.clear();
    state.offBoard = 0;
    refresh();
  });
  els.stateCode.addEventListener("focus", (event) => event.target.select());
  if (!storageAvailable()) els.storageNote.hidden = false;

  if (live && league.leagueId) {
    startLiveSync({
      league,
      players,
      state,
      onChange: refresh,
      setSlot: (slot) => {
        setSlot(slot);
        refresh();
      },
      onBadge: (badgeState, text) => {
        if (!els.liveBadge) return;
        els.liveBadge.dataset.state = badgeState;
        els.liveBadge.textContent = text;
      },
    });
  }

  refresh();
}

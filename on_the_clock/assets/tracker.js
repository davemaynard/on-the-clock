const LG = window.__LEAGUES__;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

/* ---- persistence ------------------------------------------------------ */
/* localStorage only. No capability is declared, so nothing here can prompt,
   rate-limit, or reload the page mid-draft. If storage is blocked the tracker
   still works for the session and says so, rather than pretending it saved. */
let storageOK = true;
try {
  localStorage.setItem("__t", "1");
  localStorage.removeItem("__t");
} catch (e) { storageOK = false; }

/* "b" suffix bumped 2026-08-30: gone/mine sets store row INDICES, and merging
   streamers+stubs into one row list renumbered every row — state saved against
   the old page would silently corrupt on this one. */
const KEY = (id) => `ff2026b:${id}`;
const BLANK = () => ({ gone: [], mine: [], extra: 0 });
const load = (id) => {
  if (!storageOK) return BLANK();
  try { return Object.assign(BLANK(), JSON.parse(localStorage.getItem(KEY(id)))); }
  catch (e) { return BLANK(); }
};
const save = (id, st) => {
  if (!storageOK) return;
  try {
    localStorage.setItem(KEY(id), JSON.stringify(
      { gone: [...st.gone], mine: [...st.mine], extra: st.extra || 0 }));
  } catch (e) { storageOK = false; }
};

/* A short code so a draft can be rescued onto another device, or after a
   browser evicts the tab. Indices are delta-encoded in base36 — a hundred
   picks stays well inside a line of text. */
function encodeState(st) {
  const enc = (set) => {
    const a = [...set].sort((x, y) => x - y);
    let prev = 0;
    return a.map(v => { const d = v - prev; prev = v; return d.toString(36); }).join(".");
  };
  return `${enc(st.gone)}~${enc(st.mine)}~${(st.extra || 0).toString(36)}`;
}
function decodeState(code) {
  const dec = (s) => {
    const out = new Set(); let prev = 0;
    for (const p of s.split(".")) {
      if (!p) continue;
      prev += parseInt(p, 36);
      if (Number.isFinite(prev)) out.add(prev);
    }
    return out;
  };
  const [g, m, x] = String(code).trim().split("~");
  return { gone: dec(g || ""), mine: dec(m || ""), extra: parseInt(x || "0", 36) || 0 };
}

/* ---- availability, conditioned on the real draft ---------------------- */
/* The static board assumed a player's ADP was all we knew. Once picks are
   recorded we know something stronger: how many players the market rates
   above him are STILL on the board. If `k` of them remain and `n` picks
   separate you from your turn, he survives when the room reaches past him.
   Uncertainty widens with the horizon — 40 picks out, nobody's queue holds. */
const ndtr = (z) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const poly = 1.330274 * t ** 4 - 1.821256 * t ** 3 + 1.781478 * t * t
    - 0.356538 * t + 0.319381;
  const p = d * t * poly;
  return z > 0 ? 1 - p : p;
};
function survives(k, n) {
  if (n <= 0) return 1;
  const sigma = 0.35 * n + 2;
  return Math.min(1, Math.max(0, 1 - ndtr((n - k) / sigma)));
}

/* ---- per-league controller -------------------------------------------- */
function snakePicks(slot, teams, rounds) {
  const out = [];
  for (let r = 1; r <= rounds; r++) {
    const pos = r % 2 ? slot : teams - slot + 1;
    out.push((r - 1) * teams + pos);
  }
  return out;
}

function mount(cfg) {
  const root = $(`#lg${cfg.i}`);
  const players = cfg.players;
  const st = load(cfg.id);

  /* Draft slot may be unknown until an hour before the draft (random order).
     Sources, in trust order: the payload (rebuilt after the reveal), a slot
     saved in this browser, the ESPN feed (published order / your own
     first-round pick), the manual picker. Once set from any source the feed
     never overwrites it — a human correction must stick. */
  const SLOTKEY = KEY(cfg.id) + ":slot";
  const slotSel = $(".slot-select", root);
  const setSlot = (s) => {
    cfg.slot = s;
    cfg.picks = snakePicks(s, cfg.teams, cfg.roundsTotal);
    const stat = $(".slot-stat", root);
    if (stat) stat.textContent = s;
    if (slotSel) slotSel.value = String(s);
    if (storageOK) { try { localStorage.setItem(SLOTKEY, String(s)); } catch (e) {} }
  };
  if (!cfg.slot && storageOK) {
    const saved = parseInt(localStorage.getItem(SLOTKEY) || "", 10);
    if (saved >= 1 && saved <= cfg.teams) setSlot(saved);
  }
  if (slotSel) {
    slotSel.addEventListener("change", () => {
      const v = parseInt(slotSel.value, 10);
      if (v >= 1 && v <= cfg.teams) { setSlot(v); render(); applyFilter(); }
    });
  }
  st.gone = new Set(st.gone); st.mine = new Set(st.mine);
  st.mine.forEach(i => st.gone.add(i));

  const els = {
    pick: $(".now-pick", root), clock: $(".now-clock", root),
    count: $(".now-count", root), best: $(".best-list", root),
    posbest: $(".pos-best", root), roster: $(".roster", root),
    list: $(".board-list", root), search: $(".search", root),
    filters: $$(".posfilter", root), code: $(".statecode", root),
    storeNote: $(".store-note", root), unlistedN: $(".unlisted-n", root),
    undos: $$(".undo", root),
  };
  /* Manual entry needs a way back. Every change pushes a snapshot; Undo pops it.
     A mis-tap during a fast round otherwise means hunting for what you broke. */
  /* The stack survives a refresh: snapshots are plain index arrays, so 40 of
     them are a few KB — cheap insurance against a misclick noticed late. */
  const HIST = KEY(cfg.id) + ":hist";
  let history = [];
  if (storageOK) {
    try {
      history = (JSON.parse(localStorage.getItem(HIST)) || [])
        .map(h => ({ gone: new Set(h.g), mine: new Set(h.m), extra: h.x || 0 }));
    } catch (e) { history = []; }
  }
  const saveHist = () => {
    if (!storageOK) return;
    try {
      localStorage.setItem(HIST, JSON.stringify(
        history.map(h => ({ g: [...h.gone], m: [...h.mine], x: h.extra }))));
    } catch (e) {}
  };
  const syncUndos = () => els.undos.forEach(u => { u.disabled = !history.length; });
  const snapshot = () => {
    history.push({ gone: new Set(st.gone), mine: new Set(st.mine), extra: st.extra || 0 });
    if (history.length > 40) history.shift();
    saveHist();
    syncUndos();
  };
  syncUndos();

  const rows = new Map();
  $$(".row", els.list).forEach(el => rows.set(+el.dataset.i, el));

  /* Collapsible assistant. The whole .now panel is sticky, and on a phone the
     expanded panel is half the screen — fold state persists per league so the
     board opens the way it was left. The tools bar sticks just below whatever
     height the panel currently has, via --nowh. */
  const now = $(".now", root), foldBtn = $(".now-fold", root);
  const FOLD = KEY(cfg.id) + ":fold";
  const setFold = (on) => {
    now.classList.toggle("folded", on);
    foldBtn.setAttribute("aria-expanded", String(!on));
    foldBtn.setAttribute("aria-label",
      on ? "Expand draft assistant" : "Collapse draft assistant");
    if (storageOK) {
      try { localStorage.setItem(FOLD, on ? "1" : "0"); } catch (e) {}
    }
  };
  let folded = false;
  try { folded = localStorage.getItem(FOLD) === "1"; } catch (e) {}
  /* Score display: VOR (the market's number) or fit (VOR + roster-need bonus,
     the number the green rails actually rank by). Tapping any score flips it. */
  const FIT = KEY(cfg.id) + ":fit";
  let fitMode = false;
  try { fitMode = localStorage.getItem(FIT) === "1"; } catch (e) {}
  setFold(folded);
  foldBtn.addEventListener("click", () => setFold(!now.classList.contains("folded")));
  $(".now-head", root).addEventListener("click", (ev) => {
    if (ev.target.closest("button")) return;
    setFold(!now.classList.contains("folded"));
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() =>
      root.style.setProperty("--nowh", now.offsetHeight + "px")).observe(now);
  }

  /* market queue: index order by ADP, used for the conditional model. The
     field is `a` — this once read `.adp`, which is undefined, so the "better
     by market" queue silently ran in board (VOR) order instead. */
  const byAdp = players.map((p, i) => i).sort((a, b) => players[a].a - players[b].a);

  function nextPick(drafted) {
    const onClock = drafted + 1;
    for (const p of cfg.picks) if (p >= onClock) return p;
    return null;
  }

  function render() {
    /* Off-board picks advance the clock too: the larger of the manual +1
       count and the live feed's own off-board tally, merged via max so a
       hand-entered pick the feed later confirms is never counted twice. */
    const drafted = st.gone.size + Math.max(st.extra || 0, cfg.feedExtra || 0);
    const np = nextPick(drafted);
    const onClock = np !== null && np === drafted + 1;

    /* ESPN's own "this draft is over" flag beats the local clock: picks the
       board never saw (off-board names, a D/ST the feed dropped) leave the
       tally short, and a finished draft must not still say "2 picks away". */
    els.pick.textContent = cfg.done || np === null ? "\u2013" : np;
    const away = np === null ? 0 : np - drafted - 1;
    els.clock.textContent = cfg.done
      ? "Draft complete"
      : (onClock
        ? "You're on the clock"
        : (np === null
          ? (cfg.picks.length ? "Draft complete" : "Slot TBD")
          : `${away} pick${away === 1 ? "" : "s"} away`));
    els.clock.classList.toggle("live", onClock && !cfg.done);
    els.count.textContent = `${drafted} off the board`;

    const avail = players.map((p, i) => i).filter(i => !st.gone.has(i));
    els.unlistedN.textContent = st.extra ? `${st.extra} unlisted` : "";
    const n = np === null ? 0 : Math.max(0, np - drafted - 1);

    /* how many better-by-market players are still there, for each available guy */
    let seen = 0;
    const queue = new Map();
    for (const idx of byAdp) { if (!st.gone.has(idx)) { queue.set(idx, seen); seen++; } }

    /* ---- roster-aware need model v2 --------------------------------- */
    /* Need is not a constant — it is the COST OF WAITING: what the best
       available at a position loses between your next pick and the pick
       after it, measured on the live pool with the same conditional
       survival model the drawer uses. A tier evaporating collapses the
       number (never chase a run you already missed); a run starting in
       front of you inflates it. An open slot whose wait-cost is ~0 is a
       slot the league will fill for free later — the thesis, now enforced
       by the ranking instead of contradicted by it. */
    const byPos = {};
    st.mine.forEach(i => { const q = players[i].p; byPos[q] = (byPos[q] || 0) + 1; });
    const open = {};
    for (const q of ["QB", "RB", "WR", "TE", "K", "DST"]) {
      open[q] = Math.max(0, (cfg.slots[q] || 0) - (byPos[q] || 0));
    }
    /* Flex-family slots (FLEX, OP/superflex, …) come from the league payload,
       narrowest first. Each family absorbs the surplus at its eligible
       positions; what it can't absorb is an opening. In a superflex league a
       second QB fills the OP slot instead of being penalized as a luxury. */
    const fams = cfg.families || [];
    const extras = {};
    for (const q of ["QB", "RB", "WR", "TE"]) {
      extras[q] = Math.max(0, (byPos[q] || 0) - (cfg.slots[q] || 0));
    }
    const famOpen = fams.map(f => {
      let open = f.count;
      for (const q of f.eligible) {
        if (!open) break;
        const use = Math.min(open, extras[q] || 0);
        extras[q] -= use; open -= use;
      }
      return open;
    });
    const flexOpen = famOpen.reduce((a, b) => a + b, 0);
    const inAnyFam = (q) => fams.some(f => f.eligible.includes(q));

    /* horizon: picks by OTHERS between now and the pick after np — the
       question is always "take it at my next pick, or wait one more" */
    const np2 = np === null ? null : (cfg.picks.find(pk => pk > np) ?? null);
    const n2 = np2 === null ? null : Math.max(0, np2 - drafted - 2);
    const healthy = avail.filter(i => !players[i].s && !players[i].o);
    const wait = (test) => {
      const list = healthy.filter(i => test(players[i].p));
      if (!list.length || n2 === null) return 0;
      const now = Math.max(...list.map(i => players[i].v));
      const later = list.filter(i => survives(queue.get(i) ?? 0, n2) >= 0.5)
        .map(i => players[i].v);
      /* nobody at the position is likely to last: price the worst case */
      const next = later.length ? Math.max(...later)
        : Math.min(...list.map(i => players[i].v));
      return Math.max(0, now - next);
    };
    const waitPos = {};
    /* K/DST included so bonus() never reads an undefined wait-cost when a
       scored streamer hits score() — wait() returns 0 for them (healthy
       excludes streamers), which is also the right answer. */
    for (const q of ["QB", "RB", "WR", "TE", "K", "DST"]) waitPos[q] = wait(x => x === q);
    const waitFam = fams.map(f => wait(x => f.eligible.includes(x)));

    /* endgame guard: once open slots meet remaining skill picks, filling
       the lineup beats any value argument */
    const myLeft = cfg.picks.filter(pk => pk > drafted).length;
    const streamNeed = (open.K || 0) + (open.DST || 0);
    const openSkill = open.QB + open.RB + open.WR + open.TE + flexOpen;
    const forced = np !== null && myLeft - streamNeed <= openSkill;
    /* endgame proper: every pick you have left is a K/D-ST pick AND there is
       nothing else the lineup still needs. Both halves are load-bearing —
       openSkill===0 alone would dim the skill board through five or six bench
       rounds, and myLeft<=streamNeed alone hides a still-empty starting slot
       behind a kicker when the picks ran short (the 2026-08-30 failure). When
       the roster is short a starter, `forced` runs the board instead. */
    const endgame = np !== null && myLeft > 0 && myLeft <= streamNeed && openSkill === 0;
    /* a position is exhausted when its own slots are filled and no flex
       family with an opening can take it — derived fresh every render */
    const exhausted = (q) =>
      !open[q] && !fams.some((f, k) => famOpen[k] > 0 && f.eligible.includes(q));

    const bonus = (q) => {
      if (open[q] > 0) return forced ? 99 : waitPos[q];
      for (let k = 0; k < fams.length; k++) {
        if (famOpen[k] > 0 && fams[k].eligible.includes(q)) {
          return forced ? 60 : waitFam[k];
        }
      }
      return inAnyFam(q) ? 0 : -25;
    };
    const score = (i) => players[i].v + (players[i].o ? 0 : bonus(players[i].p));

    /* injured/suspended players stay on the board with their badge and are
       never proposed — except marked sleepers (slp), whose reduced projection
       still clears replacement. They earn no need bonus (can't start Week 1),
       so they only surface once their raw value tops what's left: the
       late-draft IR-stash zone. */
    /* In endgame the shop inverts: only K/D-ST units filling a still-open
       slot are candidates; the rest of the draft they're excluded. */
    const ranked = avail.filter(i =>
      (endgame ? players[i].s && open[players[i].p] > 0 : !players[i].s)
      && (!players[i].o || players[i].m === "slp"))
      .sort((a, b) => score(b) - score(a));

    /* the one-line answer to "what am I shopping for right now" */
    let opt;
    if (!cfg.picks.length) {
      opt = "Draft order not out. <b>Set your slot</b> above to arm the pick math. " +
        "The board and live sync work either way.";
    }
    else if (np === null) opt = "";
    else if (endgame) opt = "Optimize for <b>K / D/ST</b>: last picks";
    else {
      const starters = ["QB", "RB", "WR", "TE"].filter(q => open[q] > 0);
      /* can go <=0 once the K/D-ST picks are spoken for and a starting slot
         is still empty — say so rather than printing "0 picks" */
      const skillLeft = myLeft - streamNeed;
      if (forced && starters.length) {
        opt = `Fill <b>${starters.join(" / ")}</b> now: ${openSkill} slot${
          openSkill === 1 ? "" : "s"}, ${skillLeft > 0
            ? `${skillLeft} pick${skillLeft === 1 ? "" : "s"}`
            : "no picks to spare"}`;
      } else if (starters.length) {
        const q = starters.sort((a, b) => waitPos[b] - waitPos[a])[0];
        const w = Math.round(waitPos[q]);
        opt = w >= 4
          ? `Optimize for <b>${q}</b>: waiting past ${np2 ?? "your next pick"} costs ~${w} pts`
          : `Open slot${starters.length === 1 ? "" : "s"} (${starters.join(", ")})` +
            " cheap later, take <b>value</b>";
      } else if (flexOpen > 0) {
        const k = famOpen.findIndex(v => v > 0);
        const w = Math.round(waitFam[k] || 0);
        opt = `Optimize for <b>${fams[k].label}</b>: ${famOpen[k]} open${
          w >= 4 ? `, waiting costs ~${w} pts` : ""}`;
      } else {
        opt = "Optimize for <b>RB/WR depth</b>: starters filled";
      }
    }
    $(".now-opt", root).innerHTML = opt;

    /* the three best fits still on the board get a green rail in the list —
       in endgame exactly one: the ideal remaining K/D-ST pick */
    const rec = new Set(ranked.slice(0, endgame ? 1 : 3));
    els.best.innerHTML = ranked.slice(0, 6).map(i => {
      const p = players[i], pr = survives(queue.get(i) ?? 0, n);
      const mk = (p.o ? '<span class="tag out">out</span>' : "") + (p.vd
        ? `<span class="tag ${p.vd.startsWith("AVOID") || p.vd.startsWith("DO NOT")
          ? "mk-avoid" : "mk-stash"}">${p.vd.toLowerCase()}</span>`
        : p.m
          ? `<span class="tag mk-${p.m}">${p.m === "alert" ? "news" : p.m}</span>`
          : "");
      return `<li class="cand ${pr >= .7 ? "hi" : pr >= .3 ? "mid" : "lo"}" data-i="${i}"${
        p.w ? ` title="${p.w.replace(/"/g, "&quot;")}"` : ""}>
        <span class="bar" style="--p:${pr.toFixed(3)}"></span>
        <button class="mine-btn" type="button" aria-label="Mark ${p.n} as mine">+</button>
        <span class="pct">${Math.round(pr * 100)}%</span>
        <span class="who"><i class="tm tm-${p.t}" aria-hidden="true"></i>${p.n}<span class="pos">${p.p}${p.r}</span>${mk}</span>
        <span class="vor" title="Tap: VOR / fit score">${
          Math.round(fitMode ? score(i) : p.v)}</span></li>`;
    }).join("");

    els.posbest.innerHTML = ["QB", "RB", "WR", "TE"].map(pos => {
      const i = ranked.find(j => players[j].p === pos && !players[j].o);
      if (i === undefined) return "";
      return `<div class="pb"><span class="pb-pos">${pos}</span>
        <span class="pb-name"><i class="tm tm-${players[i].t}" aria-hidden="true"></i>${players[i].n}</span>
        <span class="pb-vor">${Math.round(players[i].v)}</span></div>`;
    }).join("");

    /* roster: greedily fill the real starting lineup with what you own */
    const mine = [...st.mine].map(i => players[i]).sort((a, b) => b.v - a.v);
    const slots = [];
    const need = cfg.slots;
    const pool = [...mine];
    const take = (pred, label) => {
      const k = pool.findIndex(pred);
      slots.push({ label, who: k >= 0 ? pool.splice(k, 1)[0] : null });
    };
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      for (let c = 0; c < (need[pos] || 0); c++) take(p => p.p === pos, pos);
    }
    for (const f of fams) {
      for (let c = 0; c < f.count; c++) {
        take(p => f.eligible.includes(p.p), f.label);
      }
    }
    for (const pos of ["DST", "K"]) {
      for (let c = 0; c < (need[pos] || 0); c++) take(p => p.p === pos, pos);
    }
    const slotHtml = slots.map(s =>
      `<div class="slot${s.who ? " filled" : ""}"><span class="slot-l">${s.label}</span>
       <span class="slot-w${s.who ? "" : " open"}">${s.who
         ? `<i class="tm tm-${s.who.t}" aria-hidden="true"></i>${s.who.n}` : "open"}</span></div>`).join("");
    const benchHtml = pool.length
      ? `<div class="slot bench"><span class="slot-l">BENCH</span>
         <span class="slot-w">${pool.map(p => p.n).join(", ")}</span></div>`
      : "";
    els.roster.innerHTML = slotHtml + benchHtml;

    root.classList.toggle("fit-on", fitMode);
    rows.forEach((el, i) => {
      el.classList.toggle("is-gone", st.gone.has(i) && !st.mine.has(i));
      el.classList.toggle("is-mine", st.mine.has(i));
      el.classList.toggle("is-rec", rec.has(i));
      el.classList.toggle("is-exhausted", endgame && exhausted(players[i].p));
      /* Keyed off the stub flag, not the streamer flag: scored K/DST cells
         refresh with fit-mode too; only projection-less stubs keep the dash.
         Repriced rows update the .rw-v child so the struck number stays. */
      if (!players[i].sb) {
        const cell = el.querySelector(".rw-vor");
        (cell.querySelector(".rw-v") || cell).textContent =
          Math.round(fitMode ? score(i) : players[i].v);
      }
    });
    els.filters.forEach(b => b.classList.toggle("muted",
      endgame && ["QB", "RB", "WR", "TE"].includes(b.dataset.pos)
      && exhausted(b.dataset.pos)));
    els.code.value = encodeState(st);
    save(cfg.id, st);
  }

  const toggleFit = () => {
    fitMode = !fitMode;
    if (storageOK) { try { localStorage.setItem(FIT, fitMode ? "1" : "0"); } catch (e) {} }
    render();
  };
  els.list.addEventListener("click", (e) => {
    if (e.target.closest(".rw-vor")) { toggleFit(); return; }
    const mineBtn = e.target.closest(".mine-btn");
    const row = e.target.closest(".row");
    if (!row) return;
    snapshot();
    const i = +row.dataset.i;
    if (mineBtn) {
      if (st.mine.has(i)) { st.mine.delete(i); st.gone.delete(i); }
      else { st.mine.add(i); st.gone.add(i); }
    } else if (st.gone.has(i)) { st.gone.delete(i); st.mine.delete(i); }
    else { st.gone.add(i); }
    /* Typing the next name is the bottleneck when you're entering every pick by
       hand, so a search that marked someone clears itself and keeps focus. */
    if (els.search.value) { els.search.value = ""; els.search.focus(); }
    render(); applyFilter();
  });

  /* Enter marks the only remaining match — no aiming at a row on a moving list. */
  els.search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const visible = [...rows.entries()].filter(([i, el]) => !el.hidden && !st.gone.has(i));
    if (!visible.length) return;
    e.preventDefault();
    snapshot();
    st.gone.add(visible[0][0]);
    els.search.value = "";
    render(); applyFilter();
  });

  const bumpUnlisted = (d) => {
    const next = Math.max(0, (st.extra || 0) + d);
    if (next === st.extra) return;
    snapshot();
    st.extra = next;
    render();
  };
  $(".unlisted", root).addEventListener("click", () => bumpUnlisted(1));
  $(".unlisted-minus", root).addEventListener("click", () => bumpUnlisted(-1));

  els.undos.forEach(u => u.addEventListener("click", () => {
    const prev = history.pop();
    if (!prev) return;
    st.gone = prev.gone; st.mine = prev.mine; st.extra = prev.extra;
    saveHist();
    syncUndos();
    render(); applyFilter();
  }));

  const applyFilter = () => {
    const q = els.search.value.trim().toLowerCase();
    const pos = (root.querySelector(".posfilter.on") || {}).dataset?.pos || "ALL";
    const hideGone = $(".hidegone", root).checked;
    rows.forEach((el, i) => {
      const p = players[i];
      const okQ = !q || p.n.toLowerCase().includes(q) || p.t.toLowerCase().includes(q);
      const okP = pos === "ALL" || p.p === pos ||
        (pos === "FLX" && (p.p === "RB" || p.p === "WR" || p.p === "TE"));
      const okG = !hideGone || !st.gone.has(i);
      el.hidden = !(okQ && okP && okG);
    });
  };
  /* The best-available list takes the same gestures as the board: tapping a
     candidate marks him drafted, his + claims him for your roster. */
  els.best.addEventListener("click", (e) => {
    if (e.target.closest(".vor")) { toggleFit(); return; }
    const li = e.target.closest(".cand");
    if (!li) return;
    snapshot();
    const i = +li.dataset.i;
    st.gone.add(i);
    if (e.target.closest(".mine-btn")) st.mine.add(i);
    render(); applyFilter();
  });

  els.search.addEventListener("input", applyFilter);
  $(".hidegone", root).addEventListener("change", applyFilter);
  els.filters.forEach(b => b.addEventListener("click", () => {
    els.filters.forEach(o => o.classList.toggle("on", o === b));
    applyFilter();
  }));

  $(".restore", root).addEventListener("click", () => {
    const code = prompt("Paste a saved draft code:");
    if (!code) return;
    const next = decodeState(code);
    st.gone = next.gone; st.mine = next.mine;
    st.mine.forEach(i => st.gone.add(i));
    render(); applyFilter();
  });
  $(".reset", root).addEventListener("click", () => {
    if (!confirm("Clear every pick recorded for this league?")) return;
    st.gone.clear(); st.mine.clear();
    render(); applyFilter();
  });
  els.code.addEventListener("focus", (e) => e.target.select());

  if (!storageOK) {
    els.storeNote.hidden = false;
  }

  /* ---- live sync from ESPN (local server only) ------------------------ */
  /* Additive by design: a pick ESPN reports gets marked, but nothing here ever
     un-marks a player. You may know a pick before ESPN does — especially in the
     offline league, where ESPN only knows what the commissioner has typed —
     so the tap must never be overwritten by a feed that is behind. */
  if (window.__LIVE__ && cfg.leagueId) {
    const byEspn = new Map();
    players.forEach((p, i) => { if (p.e) byEspn.set(p.e, i); });
    const badge = $(".live-badge", root);

    const poll = async () => {
      try {
        const r = await fetch(`/api/draft?league=${cfg.leagueId}`, { cache: "no-store" });
        const d = await r.json();
        if (!d.ok) { setBadge("off", ""); return; }
        /* Random draft order: the moment ESPN publishes it (or your own
           first-round pick appears), lock the slot in. One-shot — a slot set
           by hand or an earlier poll is never overwritten. */
        if (!cfg.slot && cfg.team) {
          if (d.orderFinal && Array.isArray(d.pickOrder)) {
            const k = d.pickOrder.indexOf(cfg.team);
            if (k >= 0) { setSlot(k + 1); render(); applyFilter(); }
          }
          if (!cfg.slot) {
            const mine = (d.picks || []).find(
              pk => pk.team === cfg.team && pk.overall <= cfg.teams);
            if (mine) { setSlot(mine.overall); render(); applyFilter(); }
          }
        }
        let added = 0, unknown = 0;
        for (const pk of d.picks) {
          const i = byEspn.get(pk.player);
          if (i === undefined) { unknown++; continue; }   // taken, but off our board
          if (!st.gone.has(i)) { st.gone.add(i); added++; }
          if (pk.team === cfg.team && !st.mine.has(i)) { st.mine.add(i); added++; }
        }
        /* ESPN picks of players beyond the board's depth still consume picks —
           feed them into the clock so "picks away" stays right late in the
           draft, when off-board names are the norm. */
        if (unknown > (cfg.feedExtra || 0)) { cfg.feedExtra = unknown; added++; }
        if (d.drafted && !cfg.done) { cfg.done = true; added++; }
        if (added) { render(); applyFilter(); }
        const n = d.picks.length;
        const extra = unknown ? ` \u00b7 ${unknown} off-board` : "";
        /* Until ESPN actually has picks, the badge says nothing at all —
           the offline league drafts elsewhere and the idle chatter only
           distracts. The poll keeps running, so the moment a live ESPN
           draft produces picks the badge appears on its own. */
        if (!n && !d.inProgress) { setBadge("off", ""); return; }
        const label = n
          ? `${n} pick${n === 1 ? "" : "s"} from ESPN${extra}`
          : "draft live on ESPN";
        setBadge(d.inProgress ? "live" : "synced", label);
      } catch (e) {
        setBadge("off", "");
      }
    };
    const setBadge = (state, text) => {
      if (!badge) return;
      badge.dataset.state = state;
      badge.textContent = text;
    };
    poll();
    setInterval(poll, 5000);
  }

  render(); applyFilter();
}

/* ---- tabs (per-viewer chrome, deliberately not shared state) ----------- */
const tabs = $$(".tab");
tabs.forEach(t => t.addEventListener("click", () => {
  tabs.forEach(o => {
    const on = o === t;
    o.setAttribute("aria-selected", on);
    document.getElementById(o.dataset.panel).classList.toggle("is-active", on);
  });
}));

LG.forEach(mount);

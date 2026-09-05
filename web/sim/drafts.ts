// Simulated drafts against a built board, in headless Chrome.
//
//   node web/sim/drafts.ts <board.html> [drafts=10] [seed=1] [report.md]
//
// Eleven other teams pick off consensus ADP with some noise; at each of your picks the
// page's own assistant is read (the advice line and the best-available list) and set
// against an independent judge that encodes the draft principles the marks file
// states in prose: RB/WR early, QB and TE only when the cost of waiting says so,
// never an AVOID, starters filled before darts, K and D/ST with the last two picks.
// A pick where the two disagree is written up for a human read; a pick where the
// page proposes something the rules forbid is a bug.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";

type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
interface Player {
  name: string;
  pos: Position;
  vor: number;
  adp: number;
  streamer: boolean;
  out: boolean;
  stub: boolean;
  mark: string;
  verdict: string;
}
interface League {
  name: string;
  teams: number;
  roundsTotal: number;
  picks: number[];
  slots: Record<string, number>;
  flex: number;
  players: Player[];
}

const [, , boardPath, draftsArg = "10", seedArg = "1", reportPath = "sim-report.md"] = process.argv;
if (!boardPath)
  throw new Error("usage: node web/sim/drafts.ts <board.html> [drafts] [seed] [report]");
const DRAFTS = Number(draftsArg);

/* ---- a small seeded RNG so a run can be repeated ------------------------------- */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- the other eleven teams ---------------------------------------------------- */
/** One rival pick: the best few by ADP, weighted toward the top, with the room's habits. */
function rivalPick(league: League, drafted: Set<number>, overall: number, rand: () => number) {
  const round = Math.ceil(overall / league.teams);
  const lastRounds = round >= league.roundsTotal - 1;
  const pool = league.players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => !drafted.has(i) && !p.stub)
    .filter(({ p }) =>
      p.streamer ? lastRounds || round >= league.roundsTotal - 3 : !lastRounds || rand() < 0.5,
    )
    .filter(({ p }) => !p.out || round >= 10)
    .sort((a, b) => a.p.adp - b.p.adp)
    .slice(0, 10);
  if (!pool.length) return null;
  // Geometric-ish: the ADP leader goes ~35% of the time, the tenth almost never.
  const weights = pool.map((_, k) => Math.exp(-k / 2.6));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < pool.length; k++) {
    r -= weights[k];
    if (r <= 0) return pool[k].i;
  }
  return pool[pool.length - 1].i;
}

/* ---- the judge: what the plan's principles say to do with this exact state --------- */
interface Ranked {
  index: number;
  name: string;
  score: number;
  reason: string;
}

function judge(league: League, drafted: Set<number>, mine: Set<number>, overall: number): Ranked[] {
  const { players, teams, picks } = league;
  const round = Math.ceil(overall / teams);
  const following = picks.find((p) => p > overall) ?? null;
  const picksLeft = picks.filter((p) => p >= overall).length;
  const owned: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const i of mine) owned[players[i].pos]++;
  const slots = league.slots;
  const open = (pos: Position) => Math.max(0, (slots[pos] || 0) - owned[pos]);
  const flexUsed =
    Math.max(0, owned.RB - slots.RB) +
    Math.max(0, owned.WR - slots.WR) +
    Math.max(0, owned.TE - slots.TE);
  const flexOpen = Math.max(0, league.flex - flexUsed);
  const openSkill = open("QB") + open("RB") + open("WR") + open("TE") + flexOpen;
  const streamersOpen = open("K") + open("DST");
  const lastTwo = picksLeft <= 2;
  // Every remaining pick is spoken for by an empty starting slot: fill, don't shop.
  const forced = picksLeft - streamersOpen <= openSkill;

  const available = players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => !drafted.has(i) && !p.stub)
    .filter(({ p }) => p.verdict !== "AVOID")
    .filter(({ p }) => !p.out || p.mark === "slp");

  // The best still-available VOR at a position among players who will probably last to
  // the following pick: the cheap "cost of waiting" proxy the judge prices need with.
  const laterBest = (pos: Position) => {
    if (following === null) return 0;
    const later = available
      .filter(({ p }) => p.pos === pos && p.adp > following + 4)
      .map(({ p }) => p.vor);
    return later.length ? Math.max(...later) : -100;
  };
  const nowBest = (pos: Position) => {
    const now = available.filter(({ p }) => p.pos === pos).map(({ p }) => p.vor);
    return now.length ? Math.max(...now) : -100;
  };

  const ranked: Ranked[] = [];
  for (const { p, i } of available) {
    const reasons: string[] = [];
    let score = p.vor;
    if (p.streamer) {
      if (!lastTwo && !(forced && open(p.pos) > 0 && openSkill === 0)) continue;
      score = open(p.pos) > 0 ? 50 : -50;
      reasons.push("K/DST window");
    }
    if (p.verdict === "LATE ONLY" && overall < 115) continue;
    if (p.verdict === "STASH 160+" && overall < 150) continue;
    if (p.verdict === "WAIT") {
      score -= 15;
      reasons.push("WAIT chip");
    }
    if (p.mark === "target") {
      score += 8;
      reasons.push("target");
    }
    if (p.mark === "fade") {
      score -= 12;
      reasons.push("fade");
    }
    // Onesie discipline: the room prices QB and TE off a 1-QB board and this plan
    // says they come free. Hard no before the windows the script names.
    if (p.pos === "QB" && !forced) {
      if (overall < 78) {
        score -= 60;
        reasons.push("no QB before rd 7");
      } else if (overall < 102) {
        score -= 15;
        reasons.push("QB early");
      }
    }
    if (p.pos === "TE" && !forced) {
      if (overall < 43) {
        score -= 40;
        reasons.push("no TE before rd 4");
      } else if (overall < 78 && p.vor < 40) {
        score -= 10;
        reasons.push("TE early");
      }
    }
    // Need: an open starting slot is worth what waiting on it costs, and by the
    // middle rounds an empty slot is an emergency.
    const slotOpen = open(p.pos) > 0 || (["RB", "WR", "TE"].includes(p.pos) && flexOpen > 0);
    if (slotOpen && !p.streamer) {
      const cost = Math.max(0, nowBest(p.pos) - laterBest(p.pos));
      score += 0.5 * cost;
      if (forced) {
        score += 60;
        reasons.push("fill starter");
      } else if (round >= 8) {
        score += 15;
        reasons.push("open slot");
      }
    } else if (!p.streamer && round <= 9) {
      // Fifth RB with two open WR slots: depth at the wrong place.
      score -= 20;
      reasons.push("position full");
    }
    // Take the one who won't be there next turn when two are close in value.
    if (following !== null && p.adp > following + 6) {
      score -= 6;
      reasons.push("lasts");
    }
    ranked.push({ index: i, name: p.name, score, reason: reasons.join(", ") });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/* ---- driving the page ----------------------------------------------------------- */
const LEAGUE = "#league-0";
const BOARD_ROW = (index: number) => `${LEAGUE} [data-testid=board] li:nth-child(${index + 1})`;
const CANDIDATES = `${LEAGUE} [aria-label="Best available"] li`;
const ADVICE = `${LEAGUE} [aria-label="Draft assistant"] p[aria-live]`;
const NEXT = `${LEAGUE} [data-testid=next-pick]`;
const COUNT = `${LEAGUE} [data-testid=drafted-count]`;

async function waitForCount(page: Page, count: number) {
  await page.waitForFunction(
    ([selector, n]) => document.querySelector(selector)?.textContent?.trim().startsWith(`${n} off`),
    [COUNT, count] as const,
    { timeout: 5000 },
  );
}

interface PickRecord {
  draft: number;
  overall: number;
  round: number;
  advice: string;
  uiTop: string[];
  judgeTop: string[];
  taken: string;
  verdict: "AGREE" | "SOFT" | "DIVERGE" | "BUG";
  note: string;
}

async function runDraft(page: Page, league: League, draftNo: number, rand: () => number) {
  const records: PickRecord[] = [];
  const drafted = new Set<number>();
  const mine = new Set<number>();
  const total = league.teams * league.roundsTotal;
  const byName = new Map(league.players.map((p, i) => [p.name, i]));
  for (let overall = 1; overall <= total; overall++) {
    const round = Math.ceil(overall / league.teams);
    if (league.picks.includes(overall)) {
      const nextText = await page.$eval(NEXT, (el) => el.textContent?.trim());
      const advice = (await page.$eval(ADVICE, (el) => el.textContent?.trim() ?? "")) || "";
      const uiTop = await page.$$eval(CANDIDATES, (els) =>
        els.map(
          (el) =>
            el
              .querySelector("[data-claim]")
              ?.getAttribute("aria-label")
              ?.replace(/^Mark (.*) as mine$/, "$1") ?? "",
        ),
      );
      const ranked = judge(league, drafted, mine, overall);
      const judgeTop = ranked
        .slice(0, 3)
        .map((r) => `${r.name} (${Math.round(r.score)}${r.reason ? `; ${r.reason}` : ""})`);
      const judgeNames = ranked.slice(0, 3).map((r) => r.name);

      // Hard rules the page must never break, whatever the judge thinks.
      const bugs: string[] = [];
      if (nextText !== String(overall))
        bugs.push(`next-pick reads ${nextText}, clock is at ${overall}`);
      for (const name of uiTop) {
        const i = byName.get(name);
        if (i === undefined) continue;
        const p = league.players[i];
        if (drafted.has(i)) bugs.push(`${name} proposed but already drafted`);
        if (p.verdict === "AVOID") bugs.push(`${name} proposed with AVOID`);
        if (p.out && p.mark !== "slp") bugs.push(`${name} proposed while out`);
      }
      // A third body at a one-slot position (QB, TE) can never start: proposing one
      // over any RB or WR is the bug seen live at pick 139 on 2026-09-04.
      const ownedAt = (pos: Position) =>
        [...mine].filter((i) => league.players[i].pos === pos).length;
      for (const name of uiTop.slice(0, 3)) {
        const p = league.players[byName.get(name) ?? -1];
        if (p && league.slots[p.pos] === 1 && ownedAt(p.pos) >= 2)
          bugs.push(`${name} proposed as a third ${p.pos}`);
      }
      const topPlayer = league.players[byName.get(uiTop[0]) ?? -1];
      const picksLeft = league.picks.filter((p) => p >= overall).length;
      if (topPlayer?.streamer && picksLeft > 2 && !/K \/ D\/ST/.test(advice))
        bugs.push(`${uiTop[0]} (${topPlayer.pos}) is the top pick with ${picksLeft} picks left`);

      let verdict: PickRecord["verdict"] = "AGREE";
      let note = "";
      if (bugs.length) {
        verdict = "BUG";
        note = bugs.join("; ");
      } else if (uiTop[0] === judgeNames[0]) {
        verdict = "AGREE";
      } else if (judgeNames.includes(uiTop[0]) || uiTop.slice(0, 3).includes(judgeNames[0])) {
        verdict = "SOFT";
        note = "same short list, different order";
      } else {
        verdict = "DIVERGE";
        const ui = league.players[byName.get(uiTop[0]) ?? -1];
        const jd = league.players[ranked[0].index];
        note = `page wants ${ui?.pos} ${uiTop[0]} (vor ${ui?.vor}), judge wants ${jd.pos} ${jd.name} (vor ${jd.vor}; ${ranked[0].reason})`;
      }

      // Take the page's own pick, so the roster the page sees is the one it built.
      const take = byName.get(uiTop[0]);
      if (take === undefined) throw new Error(`cannot find ${uiTop[0]} on the board`);
      await page.$eval(`${BOARD_ROW(take)} [data-claim]`, (el) => (el as HTMLElement).click());
      drafted.add(take);
      mine.add(take);
      await waitForCount(page, drafted.size);
      records.push({
        draft: draftNo,
        overall,
        round,
        advice,
        uiTop: uiTop.slice(0, 3),
        judgeTop,
        taken: uiTop[0],
        verdict,
        note,
      });
    } else {
      const index = rivalPick(league, drafted, overall, rand);
      if (index === null) break;
      await page.$eval(`${BOARD_ROW(index)} button[aria-pressed]`, (el) =>
        (el as HTMLElement).click(),
      );
      drafted.add(index);
      await waitForCount(page, drafted.size);
    }
  }
  return {
    records,
    roster: [...mine].map((i) => `${league.players[i].pos} ${league.players[i].name}`),
  };
}

/** Count records by verdict. */
const tally = (records: PickRecord[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const r of records) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  return counts;
};

/* ---- main ------------------------------------------------------------------------ */
const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }));
const url = pathToFileURL(resolve(boardPath)).href;
const all: PickRecord[] = [];
const rosters: string[][] = [];
const started = Date.now();
for (let d = 1; d <= DRAFTS; d++) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector(CANDIDATES);
  const league = (await page.evaluate(() => {
    const lg = (window as unknown as { ON_THE_CLOCK: { leagues: League[] } }).ON_THE_CLOCK
      .leagues[0];
    return {
      name: lg.name,
      teams: lg.teams,
      roundsTotal: lg.roundsTotal,
      picks: lg.picks,
      slots: lg.slots,
      flex: lg.flex,
      players: lg.players,
    };
  })) as League;
  const { records, roster } = await runDraft(
    page,
    league,
    d,
    mulberry32(Number(seedArg) * 1000 + d),
  );
  if (errors.length)
    records.push({
      draft: d,
      overall: 0,
      round: 0,
      advice: "",
      uiTop: [],
      judgeTop: [],
      taken: "",
      verdict: "BUG",
      note: `page errors: ${errors.join(" | ")}`,
    });
  all.push(...records);
  rosters.push(roster);
  const counts = tally(records);
  console.log(`draft ${d}: ${JSON.stringify(counts)}  roster: ${roster.join(", ")}`);
  await context.close();
}
await browser.close();

const totals = tally(all);
const lines = [
  `# Simulated drafts: ${DRAFTS} rooms, seed ${seedArg}, ${new Date().toISOString().slice(0, 16)}`,
  "",
  `Board: ${boardPath}. ${((Date.now() - started) / 1000).toFixed(0)}s.`,
  "",
  `Verdicts over ${all.length} of your picks: ${Object.entries(totals)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}`,
  "",
  "## Bugs and divergences",
  "",
  "| Draft | Pick | Advice | Page top 3 | Judge top 3 | Verdict | Note |",
  "|---:|---:|---|---|---|---|---|",
  ...all
    .filter((r) => r.verdict === "BUG" || r.verdict === "DIVERGE")
    .map(
      (r) =>
        `| ${r.draft} | ${r.overall} | ${r.advice} | ${r.uiTop.join(" / ")} | ${r.judgeTop.join(" / ")} | ${r.verdict} | ${r.note} |`,
    ),
  "",
  "## Every pick",
  "",
  "| Draft | Pick | Advice | Page top 3 | Judge top 3 | Verdict |",
  "|---:|---:|---|---|---|---|",
  ...all.map(
    (r) =>
      `| ${r.draft} | ${r.overall} | ${r.advice} | ${r.uiTop.join(" / ")} | ${r.judgeTop.join(" / ")} | ${r.verdict} |`,
  ),
  "",
  "## Rosters the page built",
  "",
  ...rosters.map((r, k) => `- Draft ${k + 1}: ${r.join(", ")}`),
];
writeFileSync(reportPath, lines.join("\n"));
console.log(`\n${JSON.stringify(totals)} -> ${reportPath}`);

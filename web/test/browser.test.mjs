// The rendered demo in Chrome, at phone, tablet and desktop widths, light and dark.
// Measures geometry and computed style instead of eyeballing a screenshot. Renders the
// demo itself (uv run on-the-clock demo), so it needs the Python side installed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };
const DESKTOP = { width: 1440, height: 900 };

// Selectors, named once. The page is Preact with CSS modules, so class names are not a
// contract; roles, labels and a few data-testid hooks are.
const LEAGUE = "#league-0";
const BOARD_ROWS = `${LEAGUE} [data-testid=board] li`;
const CANDIDATES = `${LEAGUE} [aria-label="Best available"] li`;
const ASSISTANT = `${LEAGUE} [aria-label="Draft assistant"]`;
const TOOLS = `${LEAGUE} [data-testid=tools]`;
const ROSTER_OPEN = `${LEAGUE} [data-testid=roster] [data-state=open]`;

let browser = null;
let skipReason = "";
try {
  const { chromium } = await import("playwright");
  browser = await chromium
    .launch({ channel: "chrome", headless: true })
    .catch(() => chromium.launch({ headless: true }));
} catch (error) {
  skipReason = `browser tests skipped: ${error.message.split("\n")[0]}`;
}

describe("the demo board in Chrome", skipReason ? { skip: skipReason } : {}, () => {
  let tmp;
  let url;
  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), "on-the-clock-"));
    const out = join(tmp, "demo.html");
    execFileSync("uv", ["run", "on-the-clock", "demo", "--out", out], { cwd: ROOT, stdio: "pipe" });
    url = pathToFileURL(out).href;
  });
  after(async () => {
    await browser?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  const open = async (viewport, options = {}) => {
    const context = await browser.newContext({ viewport, ...options });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForSelector(CANDIDATES);
    return { page, context, errors };
  };
  const rect = (page, selector) =>
    page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });
  const style = (page, selector, property) =>
    page.$eval(selector, (el, prop) => getComputedStyle(el)[prop], property);
  const text = (page, selector) => page.$eval(selector, (el) => el.textContent.trim());

  for (const [name, viewport] of [
    ["phone", PHONE],
    ["tablet", TABLET],
    ["desktop", DESKTOP],
  ]) {
    test(`${name}: renders without errors, fits the viewport, shows both leagues`, async () => {
      const { page, context, errors } = await open(viewport);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.compatMode), "CSS1Compat", "standards mode");
      assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
      assert.equal(await text(page, "h1"), "On the Clock");
      assert.equal(await page.$$eval("[role=tab]", (els) => els.length), 2);
      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      assert.ok(
        scrollWidth <= clientWidth,
        `no horizontal scroll (${scrollWidth} > ${clientWidth})`,
      );
      const board = await rect(page, `${LEAGUE} [data-testid=board]`);
      assert.ok(board.width > 0 && board.right <= viewport.width + 1, "the board fits");
      const rows = await page.$$eval(BOARD_ROWS, (els) => els.length);
      assert.ok(rows > 200, `the board is deep (${rows} rows)`);
      const marks = await page.$eval(`${BOARD_ROWS} [data-team]`, (el) => {
        const cs = getComputedStyle(el);
        return { width: Number.parseFloat(cs.width), image: cs.backgroundImage.slice(0, 20) };
      });
      assert.ok(
        marks.width > 12 && marks.image.startsWith('url("data:image/png'),
        "team marks are inlined tiles",
      );
      await context.close();
    });
  }

  test("phone: the assistant sticks at the top and the tools bar sticks just below it", async () => {
    const { page, context } = await open(PHONE);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(100);
    const assistant = await rect(page, ASSISTANT);
    const tools = await rect(page, TOOLS);
    assert.equal(Math.round(assistant.top), 0, "assistant pinned to the top");
    assert.ok(
      Math.abs(tools.top - assistant.bottom) <= 1,
      `tools start where the assistant ends (${tools.top} vs ${assistant.bottom})`,
    );
    await context.close();
  });

  test("desktop: a two-column draft room with the rail pinned while the board scrolls", async () => {
    const { page, context } = await open(DESKTOP);
    const rail = await rect(page, `${LEAGUE} [data-testid=rail]`);
    const board = await rect(page, `${LEAGUE} [data-testid=board-column]`);
    assert.ok(rail.right < board.left, "rail sits left of the board");
    assert.ok(board.width > 700, `the board uses the width (${board.width}px)`);
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(100);
    const sticky = await rect(page, `${LEAGUE} [data-testid=rail-sticky]`);
    assert.equal(Math.round(sticky.top), 16, "the assistant and roster stick 1rem from the top");
    assert.ok(sticky.bottom <= 900, "the whole rail stays on screen");
    await context.close();
  });

  test("the plan: the pick script and the legend align in columns", async () => {
    const { page, context } = await open(PHONE);
    await page.click(`${LEAGUE} details summary`);
    const lefts = await page.$$eval(`${LEAGUE} details ol li > span:nth-child(3)`, (els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().left)),
    );
    assert.ok(lefts.length >= 3, "the script has steps");
    assert.equal(new Set(lefts).size, 1, `step text starts on one line (${lefts})`);
    const legend = await page.$$eval(`${LEAGUE} details dl dd`, (els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().left)),
    );
    assert.equal(legend.length, 6, "six tags explained");
    assert.equal(new Set(legend).size, 1, `meanings start on one line (${legend})`);
    const tagRight = await page.$$eval(`${LEAGUE} details dl dt`, (els) =>
      Math.max(...els.map((el) => el.firstElementChild.getBoundingClientRect().right)),
    );
    assert.ok(tagRight < legend[0], "every tag ends before the meanings begin");
    await context.close();
  });

  test("the draft: tap marks drafted, + claims a player, the roster and clock follow", async () => {
    const { page, context } = await open(PHONE);
    const firstRow = `${BOARD_ROWS}:nth-child(1)`;
    const secondRow = `${BOARD_ROWS}:nth-child(2)`;
    const openSlots = () => page.$$eval(ROSTER_OPEN, (els) => els.length);
    const before = await openSlots();

    await page.click(firstRow);
    assert.equal(
      await page.$eval(`${firstRow} button[aria-pressed]`, (el) => el.ariaPressed),
      "true",
    );
    assert.equal(
      await style(page, `${firstRow} button[aria-pressed]`, "textDecorationLine"),
      "line-through",
      "a drafted name is struck through",
    );
    assert.match(await text(page, `${LEAGUE} [data-testid=drafted-count]`), /^1 off the board/);

    const claimBefore = await style(page, `${secondRow} [data-claim]`, "backgroundColor");
    await page.click(`${secondRow} [data-claim]`);
    // Controls transition their colours over 150ms: wait for the fill, don't sample it.
    await page.waitForFunction(
      ([selector, before]) =>
        getComputedStyle(document.querySelector(selector)).backgroundColor !== before,
      [`${secondRow} [data-claim]`, claimBefore],
      { timeout: 1000 },
    );
    assert.equal(await openSlots(), before - 1, "claiming a player fills a roster slot");
    assert.ok(
      await page.$(`${LEAGUE} [data-testid=roster] [data-state=filled] [data-team]`),
      "the filled slot shows his team mark",
    );

    await page.locator(TOOLS).getByRole("button", { name: "Undo" }).click();
    assert.equal(await openSlots(), before, "undo gives the slot back");
    assert.match(await text(page, `${LEAGUE} [data-testid=clock]`), /picks? away|on the clock/);
    await context.close();
  });

  test("hover, the score mode and the rescue code", async () => {
    const { page, context } = await open(DESKTOP);
    const row = `${BOARD_ROWS}:nth-child(3)`;
    const rest = await style(page, row, "backgroundColor");
    await page.hover(row);
    await page.waitForTimeout(250);
    assert.notEqual(await style(page, row, "backgroundColor"), rest, "rows answer hover");

    const fit = page.locator(TOOLS).getByRole("button", { name: "Fit" });
    assert.equal(await fit.getAttribute("aria-pressed"), "false");
    const scoreBefore = await text(page, `${row} [data-score]`);
    await page.click(`${row} [data-score]`);
    assert.equal(await fit.getAttribute("aria-pressed"), "true", "tapping a score flips the mode");
    assert.notEqual(
      await text(page, `${row} [data-score]`),
      scoreBefore,
      "fit mode reprices the row",
    );
    await page.locator(TOOLS).getByRole("button", { name: "VOR" }).click();
    assert.equal(await text(page, `${row} [data-score]`), scoreBefore, "and back");

    assert.match(
      await page.$eval(`${LEAGUE} input[aria-label="Draft state code"]`, (el) => el.value),
      /^[0-9a-z.]*~[0-9a-z.]*~[0-9a-z]+$/,
    );
    await context.close();
  });

  test("dark mode and the dark-variant team marks", async () => {
    const { page, context } = await open(PHONE, { colorScheme: "dark" });
    assert.equal(await style(page, "body", "backgroundColor"), "rgb(15, 20, 27)");
    const light = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.dataset.team = "LV";
      document.body.append(probe);
      return getComputedStyle(probe).backgroundImage.length;
    });
    assert.ok(light > 100, "a dark-variant club still has a mark");
    await context.close();
  });

  test("keyboard: Tab reaches a player, Enter drafts him, arrows move between leagues", async () => {
    const { page, context } = await open(DESKTOP);
    await page.focus(`${LEAGUE} input[type=search]`);
    // Search, then the filters, the toggle, the score mode and undo, then the board.
    let onBoard = false;
    for (let i = 0; i < 24 && !onBoard; i++) {
      await page.keyboard.press("Tab");
      onBoard = await page.evaluate(() => {
        const el = document.activeElement;
        return Boolean(el.closest("[data-testid=board]")) && el.hasAttribute("aria-pressed");
      });
    }
    assert.ok(onBoard, "a board row's name is reachable by keyboard");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.$eval(`${BOARD_ROWS}:nth-child(1) button[aria-pressed]`, (el) => el.ariaPressed),
      "true",
    );
    await page.focus("#tab0");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement.id), "tab1");
    assert.equal(await page.$eval("#league-1", (el) => el.hidden), false);
    assert.equal(await page.$eval("#league-0", (el) => el.hidden), true);
    assert.equal(
      await page.$eval("#tab0", (el) => el.tabIndex),
      -1,
      "only the selected tab is in the Tab order",
    );
    await context.close();
  });

  test("touch: the hide-drafted checkbox is a real tap target", async () => {
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector(CANDIDATES);
    const box = await rect(page, `${TOOLS} input[type=checkbox]`);
    assert.ok(box.width >= 20 && box.height >= 20, `checkbox is ${box.width}x${box.height}`);
    await context.close();
  });
});

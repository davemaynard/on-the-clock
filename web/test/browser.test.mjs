// The rendered demo in Chrome, at phone, tablet and desktop widths, light and dark.
// Measures geometry and behaviour instead of eyeballing a screenshot. Renders the demo
// itself (uv run on-the-clock demo), so it needs the Python side installed.
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
    await page.waitForSelector(".league.is-active .candidate");
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

  for (const [name, viewport] of [
    ["phone", PHONE],
    ["tablet", TABLET],
    ["desktop", DESKTOP],
  ]) {
    test(`${name}: renders without errors, fits the viewport, shows both leagues`, async () => {
      const { page, context, errors } = await open(viewport);
      assert.deepEqual(errors, []);
      assert.equal(await page.$eval("h1", (el) => el.textContent.trim()), "On the Clock");
      assert.equal(await page.$$eval("[role=tab]", (els) => els.length), 2);
      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      assert.ok(
        scrollWidth <= clientWidth,
        `no horizontal scroll (${scrollWidth} > ${clientWidth})`,
      );
      const board = await rect(page, "#league-0 .board-list");
      assert.ok(board.width > 0 && board.right <= viewport.width + 1, "the board fits");
      const rows = await page.$$eval("#league-0 .board-list .row", (els) => els.length);
      assert.ok(rows > 200, `the board is deep (${rows} rows)`);
      const marks = await page.$eval("#league-0 .row .team-mark", (el) => {
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
    const assistant = await rect(page, "#league-0 .assistant");
    const tools = await rect(page, "#league-0 .tools");
    assert.equal(Math.round(assistant.top), 0, "assistant pinned to the top");
    assert.ok(
      Math.abs(tools.top - assistant.bottom) <= 1,
      `tools start where the assistant ends (${tools.top} vs ${assistant.bottom})`,
    );
    await context.close();
  });

  test("desktop: a two-column draft room with the rail pinned while the board scrolls", async () => {
    const { page, context } = await open(DESKTOP);
    const rail = await rect(page, "#league-0 .column-rail");
    const board = await rect(page, "#league-0 .column-board");
    assert.ok(rail.right < board.left, "rail sits left of the board");
    assert.ok(board.width > 700, `the board uses the width (${board.width}px)`);
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(100);
    const sticky = await rect(page, "#league-0 .rail-sticky");
    assert.equal(Math.round(sticky.top), 16, "the assistant and roster stick 1rem from the top");
    assert.ok(sticky.bottom <= 900, "the whole rail stays on screen");
    await context.close();
  });

  test("the draft: tap marks drafted, + claims a player, the roster and clock follow", async () => {
    const { page, context } = await open(PHONE);
    const clock = () => page.$eval("#league-0 .clock", (el) => el.textContent);
    const openSlots = () =>
      page.$$eval("#league-0 .roster .slot-player.is-open", (els) => els.length);
    const before = await openSlots();
    await page.click("#league-0 .board-list .row:nth-child(1)");
    assert.ok(
      await page.$eval("#league-0 .board-list .row:nth-child(1)", (el) =>
        el.classList.contains("is-drafted"),
      ),
    );
    assert.match(
      await page.$eval("#league-0 .drafted-count", (el) => el.textContent),
      /^1 off the board/,
    );
    await page.click("#league-0 .board-list .row:nth-child(2) .mine-button");
    assert.ok(
      await page.$eval("#league-0 .board-list .row:nth-child(2)", (el) =>
        el.classList.contains("is-mine"),
      ),
    );
    assert.equal(await openSlots(), before - 1, "claiming a player fills a roster slot");
    assert.ok(
      await page.$("#league-0 .roster .slot.is-filled .team-mark"),
      "the filled slot shows his team mark",
    );
    await page.click("#league-0 .tools .undo");
    assert.equal(await openSlots(), before, "undo gives the slot back");
    assert.match(await clock(), /picks? away|on the clock/);
    await context.close();
  });

  test("hover, fit mode and the rescue code", async () => {
    const { page, context } = await open(DESKTOP);
    const row = "#league-0 .board-list .row:nth-child(3)";
    const background = () => page.$eval(row, (el) => getComputedStyle(el).backgroundColor);
    const rest = await background();
    await page.hover(row);
    await page.waitForTimeout(250);
    assert.notEqual(await background(), rest, "rows answer hover");
    const vorBefore = await page.$eval(`${row} .row-vor`, (el) => el.textContent);
    await page.click(`${row} .row-vor`);
    assert.ok(await page.$eval("#league-0", (el) => el.classList.contains("is-fit-mode")));
    const vorAfter = await page.$eval(`${row} .row-vor`, (el) => el.textContent);
    assert.notEqual(vorBefore, vorAfter, "fit mode reprices the row");
    assert.match(
      await page.$eval("#league-0 .state-code", (el) => el.value),
      /^[0-9a-z.]*~[0-9a-z.]*~[0-9a-z]+$/,
    );
    await context.close();
  });

  test("dark mode and the dark-variant team marks", async () => {
    const { page, context } = await open(PHONE, { colorScheme: "dark" });
    assert.equal(
      await page.$eval("body", (el) => getComputedStyle(el).backgroundColor),
      "rgb(15, 20, 27)",
    );
    const light = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.className = "team-mark team-mark-LV";
      document.body.append(probe);
      return getComputedStyle(probe).backgroundImage.length;
    });
    assert.ok(light > 100, "a dark-variant club still has a mark");
    await context.close();
  });
});

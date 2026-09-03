// Refresh docs/demo-phone.png and docs/demo-desktop.png from the rendered demo.
//   uv run on-the-clock demo --out out/demo.html && node web/screenshots.mjs
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const url = pathToFileURL(resolve("out/demo.html")).href;
const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }));
for (const [name, viewport] of [
  ["phone", { width: 390, height: 844 }],
  ["desktop", { width: 1440, height: 900 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.waitForSelector(".league.is-active .candidate");
  await page.screenshot({ path: `docs/demo-${name}.png` });
  console.log(`wrote docs/demo-${name}.png`);
  await page.close();
}
await browser.close();

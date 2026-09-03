// Refresh the README images from the rendered demo:
//   docs/demo-phone.png    the board at 390x844, 2x
//   docs/demo-desktop.png  the board at 1440x900, 2x
//   docs/demo-devices.png  both, framed as a phone and a laptop in one picture
//
//   uv run on-the-clock demo --out out/demo.html && node web/screenshots.mjs
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const url = pathToFileURL(resolve("out/demo.html")).href;
const READY = '[aria-label="Best available"] li';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }));

for (const [name, viewport] of [
  ["phone", PHONE],
  ["desktop", DESKTOP],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.waitForSelector(READY);
  await page.screenshot({ path: `docs/demo-${name}.png` });
  console.log(`wrote docs/demo-${name}.png`);
  await page.close();
}

// The device picture: the two screenshots inside CSS-drawn frames, on a transparent
// ground so it reads on GitHub's light and dark themes alike. The frames are generic
// (a notch, a dynamic island, a hinge); no trademarked artwork.
const asDataUri = async (path) =>
  `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
const phoneShot = await asDataUri("docs/demo-phone.png");
const desktopShot = await asDataUri("docs/demo-desktop.png");

const mockup = `
<style>
  body { margin: 0; background: transparent; }
  .scene {
    position: relative;
    width: 1480px;
    height: 860px;
    font-size: 0;
  }
  .laptop {
    position: absolute;
    left: 0;
    top: 40px;
    width: 1180px;
  }
  .laptop .lid {
    position: relative;
    margin: 0 30px;
    padding: 18px 18px 22px;
    background: #1d1d1f;
    border-radius: 18px 18px 0 0;
    box-shadow: 0 30px 60px -30px rgba(0, 0, 0, 0.5);
  }
  .laptop .lid::before {
    /* the camera notch */
    content: "";
    position: absolute;
    left: 50%;
    top: 0;
    width: 120px;
    height: 16px;
    transform: translateX(-50%);
    background: #1d1d1f;
    border-radius: 0 0 10px 10px;
    z-index: 1;
  }
  .laptop .screen {
    display: block;
    width: 100%;
    border-radius: 6px;
    background: #fff;
  }
  .laptop .base {
    height: 22px;
    background: linear-gradient(#b9bcc1, #9a9ea4 60%, #7d8187);
    border-radius: 0 0 14px 14px;
  }
  .laptop .base::after {
    /* the lip that opens the lid */
    content: "";
    display: block;
    width: 160px;
    height: 6px;
    margin: 0 auto;
    background: #6f737a;
    border-radius: 0 0 8px 8px;
  }
  .phone {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 292px;
    padding: 12px;
    background: #111114;
    border-radius: 46px;
    box-shadow:
      0 0 0 2px #3a3a3f,
      0 40px 80px -30px rgba(0, 0, 0, 0.6);
  }
  .phone::before {
    /* the dynamic island */
    content: "";
    position: absolute;
    left: 50%;
    top: 26px;
    width: 88px;
    height: 26px;
    transform: translateX(-50%);
    background: #111114;
    border-radius: 13px;
    z-index: 1;
  }
  .phone .screen {
    /* the status-bar band the screenshot doesn't carry, so the island sits in it */
    padding-top: 56px;
    background: #f2f4f7;
    border-radius: 36px;
    overflow: hidden;
  }
  .phone .screen img {
    display: block;
    width: 100%;
  }
</style>
<div class="scene">
  <div class="laptop">
    <div class="lid"><img class="screen" src="${desktopShot}" alt=""></div>
    <div class="base"></div>
  </div>
  <div class="phone"><div class="screen"><img src="${phoneShot}" alt=""></div></div>
</div>`;

const page = await browser.newPage({
  viewport: { width: 1500, height: 900 },
  deviceScaleFactor: 2,
});
await page.setContent(mockup);
await page.waitForFunction(() => [...document.images].every((img) => img.complete));
await page.locator(".scene").screenshot({ path: "docs/demo-devices.png", omitBackground: true });
console.log("wrote docs/demo-devices.png");
await page.close();
await browser.close();

// Refresh the README images from the rendered demo:
//   docs/demo-phone.png    the board at 390x844, 2x
//   docs/demo-desktop.png  the board at 1440x900, 2x
//   docs/demo-devices.png  both, framed as a phone and a laptop in one picture
//
//   uv run on-the-clock demo --out out/demo.html && node web/screenshots.mjs
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const url = pathToFileURL(resolve("out/demo.html")).href;
const READY = '[aria-label="Best available"] li';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
/** Clear space shot around the scene, trimmed back to whatever the shadows actually paint. */
const ROOM = 200;
const SHOTS: Array<[name: string, viewport: { width: number; height: number }]> = [
  ["phone", PHONE],
  ["desktop", DESKTOP],
];

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }));

for (const [name, viewport] of SHOTS) {
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
const asDataUri = async (path: string) =>
  `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
const desktopShot = await asDataUri("docs/demo-desktop.png");

// The framed phone gets its own capture. The frame adds a status bar the browser
// screenshot has no room for, so the shot is taken that much shorter: the band and
// the shot together then fill a display of exactly 390x844, and nothing is squashed
// to make it fit. STATUS_BAR is the safe-area inset on the phones that have an island.
const STATUS_BAR = 59;
const phoneShot = await (async () => {
  const page = await browser.newPage({
    viewport: { width: PHONE.width, height: PHONE.height - STATUS_BAR },
    deviceScaleFactor: 2,
  });
  await page.goto(url);
  await page.waitForSelector(READY);
  const shot = await page.screenshot();
  await page.close();
  return `data:image/png;base64,${shot.toString("base64")}`;
})();

const mockup = `
<style>
  body { margin: 0; background: transparent; }
  :root { --room: ${ROOM}px; }
  .scene {
    /* The composition. Shadows reach past these bounds; the capture below grows the
       picture to take them in rather than the scene reserving a guessed margin. */
    position: relative;
    width: 1480px;
    height: 860px;
    margin: var(--room);
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
    /* Proportioned off a real phone rather than by eye. The display is 390x844, the
       size the board was shot at, and a 12px bezel around it puts the body at
       316x656: 2.076:1, the ratio of a 70.6 x 146.6 mm handset. Every measurement
       below is a fraction of the display width, so the frame stays right at any
       size. The frame it replaced was 2.25:1, which read as too tall and narrow. */
    --screen: 292px;
    --bezel: 12px;
    --radius: calc(var(--screen) * 0.15);
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--screen);
    padding: var(--bezel);
    background: #111114;
    border-radius: var(--radius);
    box-shadow:
      0 0 0 2px #3a3a3f,
      0 40px 80px -30px rgba(0, 0, 0, 0.6);
  }
  .phone::before {
    /* The island: 125 x 36 of a 390-wide display, sitting 11 below the display top. */
    content: "";
    position: absolute;
    left: 50%;
    top: calc(var(--bezel) + var(--screen) * 11 / 390);
    width: calc(var(--screen) * 125 / 390);
    height: calc(var(--screen) * 36 / 390);
    transform: translateX(-50%);
    background: #111114;
    border-radius: 999px;
    z-index: 1;
  }
  .phone .screen {
    /* The status bar, to the same scale as the shot below it. */
    padding-top: calc(var(--screen) * 59 / 390);
    background: #f2f4f7;
    border-radius: calc(var(--radius) - var(--bezel));
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
  viewport: { width: 1480 + 2 * ROOM, height: 860 + 2 * ROOM },
  deviceScaleFactor: 2,
});
await page.setContent(mockup);
await page.waitForFunction(() => [...document.images].every((img) => img.complete));

// Shoot the scene plus all of its clear room, then crop back to what was actually
// painted. A drop shadow reaches further than its blur radius suggests, and how much
// further is the renderer's business, not something worth predicting: this measures
// it. The crop only ever grows the picture past the scene, so the composition above
// is what it stays.
const scene = await page.locator(".scene").boundingBox();
if (!scene) throw new Error("the scene did not render");
const wide = await page.screenshot({
  clip: {
    x: scene.x - ROOM,
    y: scene.y - ROOM,
    width: scene.width + 2 * ROOM,
    height: scene.height + 2 * ROOM,
  },
  omitBackground: true,
});

const cropped = await page.evaluate(
  async ([source, inset, scale]) => {
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);

    // The bounding box of every pixel carrying any ink at all.
    let left = bitmap.width;
    let top = bitmap.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < bitmap.height; y++) {
      for (let x = 0; x < bitmap.width; x++) {
        if (data[(y * bitmap.width + x) * 4 + 3] === 0) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) throw new Error("the scene came out blank");

    // Never crop into the scene itself, however the shadows fall.
    const edge = inset * scale;
    left = Math.min(left, edge);
    top = Math.min(top, edge);
    right = Math.max(right, bitmap.width - edge - 1);
    bottom = Math.max(bottom, bitmap.height - edge - 1);

    const width = right - left + 1;
    const height = bottom - top + 1;
    const out = new OffscreenCanvas(width, height);
    out.getContext("2d")?.drawImage(bitmap, -left, -top);
    const blob = await out.convertToBlob({ type: "image/png" });
    const uri: string = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    return {
      uri,
      width,
      height,
      trimmed: { left, top, right: bitmap.width - 1 - right, bottom: bitmap.height - 1 - bottom },
    };
  },
  [`data:image/png;base64,${wide.toString("base64")}`, ROOM, 2] as const,
);

await writeFile("docs/demo-devices.png", Buffer.from(cropped.uri.split(",")[1], "base64"));
// trimmed is in device pixels, and ROOM was clear space on every side.
const grew = (trimmed: number) => Math.round((ROOM * 2 - trimmed) / 2);
console.log(
  `wrote docs/demo-devices.png (${cropped.width / 2}x${cropped.height / 2}, ` +
    `shadow room past the scene: ${grew(cropped.trimmed.left)} left, ${grew(cropped.trimmed.top)} top, ` +
    `${grew(cropped.trimmed.right)} right, ${grew(cropped.trimmed.bottom)} bottom)`,
);
await page.close();
await browser.close();

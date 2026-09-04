// Refresh the README images from the rendered demo:
//   docs/demo-phone.png    the board at 390x844, 2x
//   docs/demo-desktop.png  the board at 1440x900, 2x
//   docs/demo-devices.png  both, framed as a phone and a laptop in one picture
//
//   uv run on-the-clock demo --out out/demo.html && node web/screenshots.ts
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const url = pathToFileURL(resolve("out/demo.html")).href;
const READY = '[aria-label="Best available"] li';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
/** A 14-inch MacBook Pro's own default resolution, so the framed shot has the display's real 1.5397 aspect. */
const LAPTOP = { width: 1512, height: 982 };
/** Clear space shot around the scene, trimmed back to whatever the shadows actually paint. */
const ROOM = 200;
/** The composition the two frames are laid out in; the capture crops back to the ink. */
const SCENE = { width: 1660, height: 940 };
/** The 3D render's ground, so the two README pictures read as one family. */
const GROUND = "#adc1f8";
/** Even breathing room around the trimmed scene, as a fraction of its width. */
const MARGIN = 0.05;
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

// The device picture: the two screenshots inside CSS-drawn frames, on the same
// ground as the 3D render at the top of the README, so the two pictures read as a
// pair rather than as two unrelated shots. The frames are generic (a notch, a
// dynamic island, a hinge); no trademarked artwork.
//
// Each framed device gets its own capture at that device's real display size,
// rather than reusing a standalone screenshot taken for something else: reusing
// one means the frame has to stretch it, and a stretched screenshot is what makes
// a mockup look drawn instead of photographed.
const shoot = async (viewport: { width: number; height: number }) => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.waitForSelector(READY);
  const shot = await page.screenshot();
  await page.close();
  return `data:image/png;base64,${shot.toString("base64")}`;
};

// Both frames draw a band across the top that the browser screenshot has no room
// for, so each shot is taken that much shorter: the band and the shot together
// then fill the display exactly, and nothing is squashed to make it fit. The two
// numbers are the real ones — the safe-area inset on phones with an island, and
// the notch on a 14-inch MacBook Pro, which is 185x32 points at this resolution
// and sets the menu bar's height.
const STATUS_BAR = 59;
const MENU_BAR = 32;
const laptopShot = await shoot({ width: LAPTOP.width, height: LAPTOP.height - MENU_BAR });
const phoneShot = await shoot({ width: PHONE.width, height: PHONE.height - STATUS_BAR });

const mockup = `
<style>
  body { margin: 0; background: transparent; }
  :root { --room: ${ROOM}px; }
  .scene {
    /* The composition. Shadows reach past these bounds; the capture below grows the
       picture to take them in rather than the scene reserving a guessed margin. */
    position: relative;
    width: ${SCENE.width}px;
    height: ${SCENE.height}px;
    margin: var(--room);
    font-size: 0;
  }
  .laptop {
    /* Proportioned off Apple's own head-on product render of a 14-inch MacBook
       Pro, measured from the image rather than estimated: against a 787px-wide
       lid, the base is 955px wide and its front edge is 41px tall. The base is
       the wider of the two because it is nearer the camera, and that flare is
       most of what sells the viewing angle. The frame this replaced flared it by
       1.05x and drew the front edge half as thick as it should be, which is why
       the perspective read wrong. Every measurement is a fraction of the
       display's own width, so the frame stays right at any size. */
    --screen: 1084px;
    --bezel: calc(var(--screen) * 0.0167); /* 5.05mm beside a 302.5mm-wide display */
    --crown: calc(var(--screen) * 0.028); /* the strip above it, holding the notch */
    --chin: calc(var(--screen) * 0.0263); /* the strip below it */
    --deck: calc(var(--screen) * 0.0538); /* the base's visible front edge */
    --menu: calc(var(--screen) * 32 / 1512); /* the menu-bar band the notch hangs into */
    position: absolute;
    left: 0;
    top: 40px;
    width: calc(var(--screen) * 1.2539);
  }
  .laptop .lid {
    position: relative;
    width: var(--screen);
    margin: 0 auto;
    padding: var(--crown) var(--bezel) var(--chin);
    background: #1d1d1f;
    border-radius: calc(var(--screen) * 0.024) calc(var(--screen) * 0.024) 0 0;
    box-shadow: 0 30px 60px -30px rgba(0, 0, 0, 0.5);
  }
  .laptop .lid::before {
    /* The notch: 185 x 32 of a 1512-point display. It hangs out of the bezel and
       down through the menu-bar band below, which is why the band is there. */
    content: "";
    position: absolute;
    left: 50%;
    top: 0;
    width: calc(var(--screen) * 185 / 1512);
    height: calc(var(--crown) + var(--menu));
    transform: translateX(-50%);
    background: #1d1d1f;
    border-radius: 0 0 calc(var(--menu) * 0.3) calc(var(--menu) * 0.3);
    z-index: 1;
  }
  .laptop .screen {
    /* The menu bar, to the same scale as the shot below it. */
    padding-top: var(--menu);
    background: #f2f4f7;
    border-radius: 6px;
    overflow: hidden;
  }
  .laptop .screen img {
    display: block;
    width: 100%;
  }
  .laptop .base {
    height: var(--deck);
    background: linear-gradient(#b9bcc1, #9a9ea4 60%, #7d8187);
    border-radius: 0 0 calc(var(--deck) * 0.5) calc(var(--deck) * 0.5);
  }
  .laptop .base::after {
    /* The lip that opens the lid: 166px of the reference's 955px-wide base. */
    content: "";
    display: block;
    width: calc(var(--screen) * 0.218);
    height: calc(var(--deck) * 0.25);
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
    <div class="lid"><div class="screen"><img src="${laptopShot}" alt=""></div></div>
    <div class="base"></div>
  </div>
  <div class="phone"><div class="screen"><img src="${phoneShot}" alt=""></div></div>
</div>`;

const page = await browser.newPage({
  viewport: { width: SCENE.width + 2 * ROOM, height: SCENE.height + 2 * ROOM },
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
  async ([source, inset, scale, ground, margin]) => {
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

    // Lay the trimmed scene on the ground with an even margin all round. The
    // scene is shot against nothing so the bounds above can be measured from the
    // alpha channel; drawing it over the fill is what composites the soft shadows
    // onto the colour, at the strength the renderer gave them.
    const width = right - left + 1;
    const height = bottom - top + 1;
    const pad = Math.round((width * margin) / scale) * scale; // a whole number of CSS pixels
    const out = new OffscreenCanvas(width + 2 * pad, height + 2 * pad);
    const painted = out.getContext("2d");
    if (!painted) throw new Error("no 2d context");
    painted.fillStyle = ground;
    painted.fillRect(0, 0, out.width, out.height);
    painted.drawImage(bitmap, pad - left, pad - top);
    const blob = await out.convertToBlob({ type: "image/png" });
    const uri: string = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    return {
      uri,
      width: out.width,
      height: out.height,
      trimmed: { left, top, right: bitmap.width - 1 - right, bottom: bitmap.height - 1 - bottom },
    };
  },
  [`data:image/png;base64,${wide.toString("base64")}`, ROOM, 2, GROUND, MARGIN] as const,
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

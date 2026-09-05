// Open ESPN's draft room headless with the working directory's cookies and record where
// the live picks come from: every WebSocket frame and every JSON request the room makes.
// The log is flushed every ten seconds so it can be read while the capture runs.
//
//   ON_THE_CLOCK_DIR=... node web/sim/sniff-draft-room.ts <draft room url> [seconds] [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [, , url, seconds = "240", outPath = "sniff.json"] = process.argv;
const env = readFileSync(`${process.env.ON_THE_CLOCK_DIR}/.env`, "utf8");
const get = (k: string) =>
  env
    .match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]
    .trim()
    .replace(/^['"]|['"]$/g, "") ?? "";
const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([
  { name: "espn_s2", value: get("ESPN_S2"), domain: ".espn.com", path: "/" },
  { name: "SWID", value: get("ESPN_SWID"), domain: ".espn.com", path: "/" },
]);
const page = await context.newPage();
const log: Record<string, unknown>[] = [];
const flush = () => writeFileSync(outPath, JSON.stringify(log, null, 1));
page.on("websocket", (ws) => {
  log.push({ t: Date.now(), kind: "ws-open", url: ws.url() });
  ws.on("framereceived", (f) =>
    log.push({
      t: Date.now(),
      kind: "ws-in",
      url: ws.url(),
      data: String(f.payload).slice(0, 2000),
    }),
  );
  ws.on("framesent", (f) =>
    log.push({
      t: Date.now(),
      kind: "ws-out",
      url: ws.url(),
      data: String(f.payload).slice(0, 600),
    }),
  );
  ws.on("close", () => log.push({ t: Date.now(), kind: "ws-close", url: ws.url() }));
});
page.on("response", async (r) => {
  const u = r.url();
  if (/\.(js|css|png|svg|woff2?|gif|jpg)(\?|$)/.test(u)) return;
  let body = "";
  try {
    if ((r.headers()["content-type"] || "").includes("json"))
      body = (await r.text()).slice(0, 1000);
  } catch {}
  log.push({ t: Date.now(), kind: "http", status: r.status(), url: u.slice(0, 300), body });
});
page.on("console", (m) => {
  if (m.type() === "error")
    log.push({ t: Date.now(), kind: "console", text: m.text().slice(0, 300) });
});
await page.goto(url, { waitUntil: "domcontentloaded" });
const timer = setInterval(flush, 10_000);
await page.waitForTimeout(Number(seconds) * 1000);
clearInterval(timer);
await page.screenshot({ path: outPath.replace(/\.json$/, ".png") });
flush();
const sockets = log.filter((l) => l.kind === "ws-open").map((l) => l.url);
console.log(`captured ${log.length} events; websockets: ${sockets.join(", ") || "none"}`);
await browser.close();

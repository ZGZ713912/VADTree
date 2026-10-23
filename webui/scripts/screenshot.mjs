import { chromium } from "playwright";
import fs from "node:fs";

const exec = process.env.CHROME_PATH || "/home/noir/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
const base = process.env.BASE_URL || "http://127.0.0.1:8765";
const out = process.env.OUT_DIR || "../docs/screenshots";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exec, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push("console: " + msg.text()); });
page.on("pageerror", (err) => errors.push("pageerror: " + err.message));

async function shot(path, name, ready) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  if (ready) {
    try { await page.waitForSelector(ready, { timeout: 12000 }); } catch (err) { errors.push("ready timeout " + path + ": " + err.message); }
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + "/" + name, fullPage: true });
  console.log("shot", name);
}

await shot("/", "overview.png", ".metric__value");
await shot("/runs", "runs.png", ".run-table tbody tr");
await shot("/evidence", "evidence.png", ".timeline__svg");
await shot("/pipeline", "pipeline.png", ".stage");
await shot("/archive", "archive.png", ".bundle");

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mobilePage = await mobile.newPage();
await mobilePage.goto(base + "/", { waitUntil: "networkidle" });
await mobilePage.waitForTimeout(900);
await mobilePage.screenshot({ path: out + "/overview-mobile.png", fullPage: true });
await mobilePage.goto(base + "/evidence", { waitUntil: "networkidle" });
await mobilePage.waitForTimeout(900);
await mobilePage.screenshot({ path: out + "/evidence-mobile.png", fullPage: true });
console.log("shot mobile");

console.log("ERRORS", JSON.stringify(errors, null, 2));
await browser.close();
import { chromium } from "playwright";

const exec = process.env.CHROME_PATH || "/home/noir/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
const base = "http://127.0.0.1:8765";

const browser = await chromium.launch({ executablePath: exec, headless: true, args: ["--no-sandbox"] });
const errors = [];
const results = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("console", (msg) => { if (msg.type() === "error") errors.push("console: " + msg.text()); });
page.on("pageerror", (err) => errors.push("pageerror: " + err.message));

async function noOverflow(name, p = page) {
  const data = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  results.push({ check: "overflow:" + name, ok: data.sw <= data.w + 1, detail: data });
}

await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForSelector(".metric__value");
await noOverflow("desk-desktop");
await page.locator(".strip").first().click();
await page.waitForURL(/\/evidence/);
await page.waitForSelector(".timeline__svg");
results.push({ check: "strip->evidence", ok: page.url().includes("/evidence?run=") });
const boxes = await page.evaluate(() => {
  const title = document.querySelector(".video-title h2")?.getBoundingClientRect();
  const score = document.querySelector(".video-title__score")?.getBoundingClientRect();
  return title && score ? { titleRight: Math.round(title.right), scoreLeft: Math.round(score.left), titleTop: Math.round(title.top), scoreTop: Math.round(score.top) } : null;
});
results.push({ check: "title-score-separation", ok: !!boxes && (boxes.titleRight <= boxes.scoreLeft || boxes.scoreTop >= boxes.titleTop), detail: boxes });

await page.locator(".inspector__tab").nth(1).click();
await page.waitForTimeout(250);
const fineActive = await page.locator(".node-chip.is-active").count();
results.push({ check: "fine-tab-selects-node", ok: fineActive === 1 });

await page.keyboard.press("Control+K");
await page.waitForSelector(".palette__input");
await page.locator(".palette__input").fill("Explosion022");
await page.waitForTimeout(500);
const hitCount = await page.locator(".palette__item").count();
results.push({ check: "palette-results", ok: hitCount > 0, detail: hitCount });
if (hitCount) {
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  results.push({ check: "palette-navigates", ok: page.url().includes("/evidence") });
}

await page.goto(base + "/runs", { waitUntil: "networkidle" });
await page.waitForSelector(".run-table tbody tr");
const before = await page.locator(".run-detail__title").innerText();
await page.locator(".run-table tbody tr").nth(2).click();
await page.waitForTimeout(500);
const after = await page.locator(".run-detail__title").innerText();
results.push({ check: "run-row-select", ok: before !== after || (await page.locator(".run-row.is-selected").count()) === 1 });
await noOverflow("runs-desktop");

await page.goto(base + "/pipeline", { waitUntil: "networkidle" });
await page.waitForSelector(".stage");
results.push({ check: "pipeline-seven-stages", ok: (await page.locator(".stage").count()) === 7 });
await noOverflow("pipeline-desktop");

await page.goto(base + "/archive", { waitUntil: "networkidle" });
await page.waitForSelector(".bundle");
const archiveText = await page.locator(".page-head__kicker").innerText();
results.push({ check: "archive-all-files", ok: archiveText.includes("96/96"), detail: archiveText });
await noOverflow("archive-desktop");

await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForSelector(".metric__value");
await noOverflow("overview-desktop");

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const m = await mobile.newPage();
const mobileErrors = [];
m.on("console", (msg) => { if (msg.type() === "error") mobileErrors.push(msg.text()); });
m.on("pageerror", (err) => mobileErrors.push(err.message));
await m.goto(base + "/", { waitUntil: "networkidle" });
await m.waitForSelector(".metric__value");
await noOverflow("overview-mobile", m);
await m.goto(base + "/evidence", { waitUntil: "networkidle" });
await m.waitForSelector(".timeline__svg");
await noOverflow("evidence-mobile", m);
await m.goto(base + "/query", { waitUntil: "networkidle" });
await m.waitForSelector(".query-layout");
await noOverflow("query-mobile", m);
results.push({ check: "mobile-console", ok: mobileErrors.length === 0, detail: mobileErrors });

console.log(JSON.stringify({ results, errors, mobileErrors }, null, 2));
await browser.close();
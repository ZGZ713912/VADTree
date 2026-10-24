import { chromium } from "playwright";

const exec = "/home/noir/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
const base = "http://127.0.0.1:8765";
const video = process.env.TEST_VIDEO || "/tmp/vadtree-query-test/red_box.mp4";
const description = process.env.TEST_DESCRIPTION || "画面中有一个红色方块";
const browser = await chromium.launch({ executablePath: exec, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(err.message));
await page.goto(base + "/query", { waitUntil: "networkidle" });
await page.waitForSelector(".query-layout");
const ready = await page.locator(".tag--moss").filter({ hasText: "就绪" }).count();
console.log("CLIP_READY", ready);
await page.setInputFiles("input[type=file]", video);
await page.waitForSelector(".upload-preview", { timeout: 60000 });
console.log("UPLOADED", await page.locator(".upload-preview__meta b").innerText());
await page.fill(".query-description", description);
await page.getByRole("button", { name: /开始本地判断/ }).click();
try {
  await page.waitForSelector(".query-result", { timeout: 300000 });
  console.log("RESULT_READY");
} catch (err) {
  console.log("RESULT_TIMEOUT");
  console.log((await page.locator(".query-log").innerText().catch(() => "")).slice(-2500));
  await page.screenshot({ path: "../docs/screenshots/query-error.png", fullPage: true });
  console.log("ERRORS", JSON.stringify(errors));
  await browser.close();
  process.exit(1);
}
const score = await page.locator(".query-score__number").innerText();
const verdict = await page.locator(".query-result__head .tag").innerText();
console.log("SCORE", score.replace(/\n/g, " "), "VERDICT", verdict);
const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
console.log("OVERFLOW", overflow);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: "../docs/screenshots/query.png", fullPage: true });
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mobilePage = await mobile.newPage();
await mobilePage.goto(base + "/query", { waitUntil: "networkidle" });
await mobilePage.waitForSelector(".query-layout");
await mobilePage.setInputFiles("input[type=file]", video);
await mobilePage.waitForSelector(".upload-preview", { timeout: 60000 });
await mobilePage.fill(".query-description", description);
await mobilePage.getByRole("button", { name: /开始本地判断/ }).click();
await mobilePage.waitForSelector(".query-result", { timeout: 300000 });
await mobilePage.evaluate(() => window.scrollTo(0, 0));
await mobilePage.waitForTimeout(300);
await mobilePage.screenshot({ path: "../docs/screenshots/query-mobile.png", fullPage: true });
const mOverflow = await mobilePage.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
console.log("MOBILE_OVERFLOW", mOverflow);
const offenders = await mobilePage.evaluate(() => [...document.querySelectorAll("*")]
  .map((el) => {
    const rect = el.getBoundingClientRect();
    return { tag: el.tagName, cls: el.className && String(el.className).slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), text: (el.textContent || "").trim().slice(0, 60) };
  })
  .filter((x) => x.right > window.innerWidth + 1 || x.left < -1)
  .slice(0, 12));
console.log("OFFENDERS", JSON.stringify(offenders, null, 2));
console.log("ERRORS", JSON.stringify(errors));
await browser.close();

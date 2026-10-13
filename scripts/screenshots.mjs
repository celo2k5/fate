import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const out = process.argv[2];
const list = await (await page.request.get("http://localhost:3000/api/tokens?sort=trending")).json();
const phoenix = list.find(t => t.destiny === "PHOENIX");
const echo = list.find(t => t.destiny === "ECHO");
const orbit = list.find(t => t.destiny === "ORBIT");
const shots = [["home", "/"], ["coins", "/coins?tab=trending"], ["phoenix-page", "/destinies/phoenix"], ["launch", "/launch"], ["leaderboards", "/leaderboards"], ["coin-phoenix", `/coin/${phoenix.id}`], ["coin-echo", `/coin/${echo.id}`], ["coin-orbit", `/coin/${orbit.id}`]];
async function scrollThrough(pg) {
  await pg.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 90)); } window.scrollTo({ top: 0, behavior: 'instant' }); });
  await pg.waitForTimeout(900);
}
for (const [n, u] of shots) {
  await page.goto("http://localhost:3000" + u, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (n !== "home") await scrollThrough(page);
  await page.screenshot({ path: `${out}/${n}.png`, fullPage: n !== "home" });
}
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" }); await page.waitForTimeout(1200); await scrollThrough(page);
await page.screenshot({ path: `${out}/home-full.png`, fullPage: true });
const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mp = await m.newPage();
await mp.goto("http://localhost:3000/", { waitUntil: "networkidle" }); await mp.waitForTimeout(1200); await scrollThrough(mp);
await mp.screenshot({ path: `${out}/home-mobile.png`, fullPage: true });
await mp.goto(`http://localhost:3000/coin/${phoenix.id}`, { waitUntil: "networkidle" }); await mp.waitForTimeout(1200); await scrollThrough(mp);
await mp.screenshot({ path: `${out}/coin-mobile.png`, fullPage: true });
await b.close();

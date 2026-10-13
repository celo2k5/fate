import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const out = process.argv[2];
await page.goto("http://localhost:3000/admin/login", { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/admin-login.png` });
await page.getByTestId("admin-key").fill("fate-admin"); await page.getByTestId("admin-login").click();
await page.waitForURL(/\/admin$/); await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/admin.png`, fullPage: true });
await page.getByRole("button", { name: "Operations" }).click(); await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/admin-ops.png`, fullPage: true });
for (const [n, u] of [["coins", "/coins"], ["destinies", "/destinies"], ["leaderboards", "/leaderboards"], ["wallet", "/wallet"]]) {
  await page.goto("http://localhost:3000" + u, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise(r => setTimeout(r, 80)); } window.scrollTo({ top: 0, behavior: "instant" }); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
}
await b.close();

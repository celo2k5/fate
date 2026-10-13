import { chromium } from "/home/claude/fate/node_modules/@playwright/test/index.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
const FPS = 30, DUR = 50;
const srv = spawn("python3", ["-m", "http.server", "8123", "--bind", "127.0.0.1"], { cwd: "/home/claude/trailer/src", stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:8123/trailer.html", { waitUntil: "networkidle" });
await page.evaluate(() => window.ready); await page.waitForTimeout(500);
fs.mkdirSync("/home/claude/trailer/out/frames", { recursive: true });
const n = FPS * DUR; const t0 = Date.now();
for (let i = 0; i < n; i++) {
  const t = i / FPS;
  await page.evaluate((t) => window.seek(t), t);
  await page.screenshot({ path: `/home/claude/trailer/out/frames/f${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92 });
  if (i % 150 === 0) console.log(`frame ${i}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await b.close(); srv.kill(); console.log("done");

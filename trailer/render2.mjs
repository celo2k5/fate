import { chromium } from "/home/claude/fate/node_modules/@playwright/test/index.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
const FPS = 30; const only = process.argv[2] ? process.argv.slice(2).map(Number) : null;
const srv = spawn("python3", ["-m", "http.server", "8124", "--bind", "127.0.0.1"], { cwd: "/home/claude/trailer/src", stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", e => console.log("PAGEERR", e.message));
await page.goto("http://127.0.0.1:8124/trailer2.html", { waitUntil: "networkidle" });
await page.evaluate(() => window.ready); await page.waitForTimeout(500);
const END = await page.evaluate(() => window.END);
const dir = only ? "/home/claude/trailer/out/check" : "/home/claude/trailer/out/frames2";
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const n = Math.ceil(FPS * END); const t0 = Date.now();
const list = only ?? [...Array(n).keys()];
for (const i of list) {
  await page.evaluate((t) => window.seek(t), i / FPS);
  await page.screenshot({ path: `${dir}/f${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92 });
  if (i % 150 === 0) console.log(`frame ${i}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await b.close(); srv.kill(); console.log("done", END, n);

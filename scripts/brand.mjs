// Renders the raster brand kit from HTML with the real brand type: favicons, OG image, X banner, logo PNGs.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fonts = `<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Permanent+Marker&display=swap" rel="stylesheet">`;
const mark = fs.readFileSync("public/brand/mark.svg", "utf8");
const bannerBg = "data:image/jpeg;base64," + fs.readFileSync("public/brand/banner-bg.jpg").toString("base64");
async function shot(html, w, h, out, scale = 1) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${fonts}<style>html,body{margin:0;background:#0b0516;color:#f2eeff;font-family:"Unbounded",sans-serif}.d{font-weight:800;text-transform:uppercase;letter-spacing:-.02em;line-height:.98}.m{font-family:"Permanent Marker";color:#0b0516;background:#4dffc3;padding:.05em .35em .1em;border-radius:.18em;display:inline-block;transform:rotate(-3deg)}</style></head><body>${html}</body></html>`);
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  await p.screenshot({ path: out, omitBackground: out.includes("transparent") });
  await p.close();
}
// favicons
for (const s of [16, 32, 48, 180, 192, 512]) await shot(`<div style="width:${s}px;height:${s}px">${fs.readFileSync("public/brand/favicon.svg", "utf8").replace("<svg", `<svg width="${s}" height="${s}"`)}</div>`, s, s, `public/brand/icon-${s}.png`);
// logo lockups
await shot(`<div style="display:flex;align-items:center;gap:28px;padding:40px">${mark.replace("<svg", '<svg width="160" height="160"')}<span class="d" style="font-size:150px">Fate</span></div>`, 640, 240, "public/brand/logo-transparent.png", 2);
await shot(`<div style="display:flex;align-items:center;gap:28px;padding:40px">${mark.replace("<svg", '<svg width="160" height="160"')}<span class="d" style="font-size:150px">Fate</span></div>`, 640, 240, "public/brand/logo-dark.png", 2);
// OG 1200x630
await shot(`<div style="position:relative;width:1200px;height:630px;overflow:hidden">
  <img src="${bannerBg}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,5,22,.92) 0%,rgba(11,5,22,.75) 42%,rgba(11,5,22,0) 70%)"></div>
  <div style="position:absolute;left:64px;top:60px;display:flex;align-items:center;gap:16px">${mark.replace("<svg", '<svg width="56" height="56"')}<span class="d" style="font-size:44px">Fate</span></div>
  <div style="position:absolute;left:64px;top:190px;width:640px"><div class="d" style="font-size:72px">Every coin<br>has a destiny</div><div style="margin-top:22px"><span class="m" style="font-size:34px">chosen once · enforced forever</span></div>
  <div style="margin-top:28px;font-family:'Space Grotesk',sans-serif;font-size:20px;color:rgba(242,238,255,.78);line-height:1.5;width:560px">A Solana launchpad where trading fees fund one permanent, protocol-enforced destiny: buyback &amp; burn, locked liquidity, holder rewards, or an autonomous treasury.</div></div>
</div>`, 1200, 630, "public/brand/og.png");
// X header 1500x500
await shot(`<div style="position:relative;width:1500px;height:500px;overflow:hidden">
  <img src="${bannerBg}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 40%">
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,5,22,.9) 0%,rgba(11,5,22,.6) 45%,rgba(11,5,22,0) 70%)"></div>
  <div style="position:absolute;left:90px;top:120px"><div style="display:flex;align-items:center;gap:16px">${mark.replace("<svg", '<svg width="64" height="64"')}<span class="d" style="font-size:52px">Fate</span></div>
  <div class="d" style="font-size:58px;margin-top:26px">Every coin has a destiny</div><div style="margin-top:16px"><span class="m" style="font-size:30px">chosen once · enforced forever</span></div></div>
</div>`, 1500, 500, "public/brand/banner-x.png");
await b.close();
console.log(fs.readdirSync("public/brand"));

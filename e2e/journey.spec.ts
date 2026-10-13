/**
 * The required end-to-end journey (spec §22), driven through the real UI with
 * the built-in simnet wallet (ed25519 keypair in the browser, signatures
 * verified server-side). Every assertion reads state the protocol recorded.
 */
import { test, expect, type Page } from "@playwright/test";

const DESTINIES = ["PHOENIX", "GRAVITY", "ECHO", "ORBIT"] as const;
type Destiny = (typeof DESTINIES)[number];

async function connect(page: Page) {
  await page.goto("/wallet");
  await page.getByTestId("connect").click();
  await page.getByTestId("connect-local").click();
  await expect(page.getByTestId("address")).toBeVisible();
  // fund generously: fee volume needs real SOL
  for (let i = 0; i < 12; i++) await page.request.post("/api/faucet");
  await page.reload();
  await expect(page.getByTestId("balance")).toContainText("300");
}

async function launch(page: Page, destiny: Destiny, opts: { graduation?: number } = {}) {
  await page.goto("/launch");
  await page.getByTestId("name").fill(`${destiny} Coin`);
  await page.getByTestId("ticker").fill(destiny.slice(0, 4));
  await page.getByTestId("description").fill(`An end-to-end ${destiny} coin.`);
  await page.getByTestId("next").click();
  await page.getByTestId(`pick-${destiny}`).click();
  await page.getByTestId("next").click();
  // economics: smallest execution threshold, shortest cooldown
  const sliders = page.locator('input[type="range"]');
  await sliders.nth(0).fill("0.25");
  await sliders.nth(1).fill("5");
  if (opts.graduation) await sliders.nth(3).fill(String(opts.graduation));
  if (destiny === "ECHO") { await sliders.nth(4).fill("1000"); await sliders.nth(5).fill("0.5"); }
  await page.getByTestId("next").click();
  await expect(page.getByText("Your destiny cannot be changed after launch.")).toBeVisible();
  await page.getByTestId("next").click();
  await page.getByTestId("launch").click();
  await expect(page.getByTestId("launch-success")).toBeVisible({ timeout: 20_000 });
  await page.waitForURL(/\/coin\//, { timeout: 20_000 });
  const id = page.url().split("/coin/")[1];
  const d = await (await page.request.get(`/api/tokens/${id}`)).json();
  expect(d.config.destiny).toBe(destiny);
  expect(d.state.state).toBe("IDLE");
  expect(d.vault).toBe("0");
  return id;
}

async function trade(page: Page, side: "BUY" | "SELL", amount: string) {
  await page.getByTestId(`side-${side}`).click();
  await page.getByTestId("amount").fill(amount);
  await expect(page.getByTestId("quote")).toBeVisible();
  await page.getByTestId("submit-trade").click();
  await expect(page.getByTestId("trade-result")).toContainText(side === "BUY" ? "Bought" : "Sold", { timeout: 15_000 });
}

async function vault(page: Page, id: string): Promise<bigint> {
  return BigInt((await (await page.request.get(`/api/tokens/${id}`)).json()).vault);
}

async function accumulate(page: Page, id: string, target = 250_000_000n) {
  await page.goto(`/coin/${id}`);
  for (let i = 0; i < 12 && (await vault(page, id)) < target; i++) {
    await trade(page, "BUY", "5");
    await trade(page, "SELL", "20000000");
  }
  expect(await vault(page, id)).toBeGreaterThanOrEqual(target);
}

/** Click the permissionless crank, then wait until the ledger shows a completed execution (the keeper may get there first). */
async function executeAndVerify(page: Page, id: string, word: string, minExecutions = 1) {
  await page.goto(`/coin/${id}`);
  await page.getByTestId("crank").click();
  await expect(page.getByTestId("crank-result")).toContainText(/Executed|Not executed/, { timeout: 15_000 });
  await expect.poll(async () => {
    const d = await (await page.request.get(`/api/tokens/${id}`)).json();
    return d.executions.filter((e: { status: string }) => e.status === "COMPLETED").length;
  }, { timeout: 20_000, intervals: [1000] }).toBeGreaterThanOrEqual(minExecutions);
  await page.reload();
  await expect(page.getByTestId("executions")).toContainText(word);
}

test.describe.configure({ mode: "serial" });

test("journey: wallet → launch PHOENIX → trade → fees → buyback → burn → history", async ({ page }) => {
  await connect(page);
  const id = await launch(page, "PHOENIX");

  // buy & sell through the UI; fees enter the Phoenix vault
  await page.goto(`/coin/${id}`);
  await trade(page, "BUY", "2");
  const afterBuy = await vault(page, id);
  expect(afterBuy).toBe(16_000_000n); // 2 SOL * 1% * 80%
  await trade(page, "SELL", "1000000");
  expect(await vault(page, id)).toBeGreaterThan(afterBuy);
  const trades = await (await page.request.get(`/api/tokens/${id}`)).json();
  expect(trades.trades.length).toBe(2);
  expect(trades.state.state).toBe("ACCUMULATING");

  // accumulate to the threshold, then execute the buyback via the permissionless crank button
  await accumulate(page, id);
  await executeAndVerify(page, id, "Bought and burned");

  const d = await (await page.request.get(`/api/tokens/${id}`)).json();
  expect(Number(d.state.executions)).toBeGreaterThanOrEqual(1);
  expect(BigInt(d.state.total_burned)).toBeGreaterThan(0n);
  expect(d.token.burned).toBe(d.state.total_burned);
  expect(BigInt(d.token.circulating)).toBe(1_000_000_000_000_000n - BigInt(d.token.burned));
  const burnedViaExecutions = d.executions.filter((e: { status: string }) => e.status === "COMPLETED").reduce((s: bigint, e: { result_json: string }) => s + BigInt(JSON.parse(e.result_json).tokensBurned), 0n);
  expect(burnedViaExecutions).toBe(BigInt(d.state.total_burned));
  await expect(page.getByTestId("burned")).not.toHaveText(/^0/);
});

test("journey: GRAVITY locks liquidity in escrow", async ({ page }) => {
  await connect(page);
  const id = await launch(page, "GRAVITY");
  await accumulate(page, id);
  await executeAndVerify(page, id, "Locked");
  const d = await (await page.request.get(`/api/tokens/${id}`)).json();
  expect(d.positions.length).toBeGreaterThanOrEqual(1);
  expect(d.positions[0].stage).toBe("ESCROW");
  expect(BigInt(d.position.s)).toBeGreaterThan(0n);
  expect(BigInt(d.state.total_liquidity_added)).toBe(BigInt(d.position.s));
  expect(d.positions.every((x: { stage: string }) => x.stage === "ESCROW")).toBe(true);
});

test("journey: ECHO settles an epoch and the holder claims once", async ({ page }) => {
  await connect(page);
  const id = await launch(page, "ECHO");
  // buy and hold (no sells!) so this wallet is eligible; generate fees with buys only
  await page.goto(`/coin/${id}`);
  for (let i = 0; i < 8; i++) await trade(page, "BUY", "4");
  expect(await vault(page, id)).toBeGreaterThanOrEqual(250_000_000n);
  // wait for the 30 s epoch to end; the in-process keeper settles it
  await expect.poll(async () => (await (await page.request.get(`/api/tokens/${id}`)).json()).epochs.length, { timeout: 60_000, intervals: [2000] }).toBe(1);
  const d = await (await page.request.get(`/api/tokens/${id}`)).json();
  expect(Number(d.epochs[0].eligible_wallets)).toBe(1);
  await page.goto(`/coin/${id}`);
  await page.getByTestId("claim").click();
  await expect(page.getByTestId("claim-result")).toContainText("Claimed", { timeout: 15_000 });
  await expect(page.locator("span").filter({ hasText: /^Claimed$/ })).toBeVisible();
  // the API refuses a second claim
  const second = await (await page.request.get(`/api/tokens/${id}/claim`)).json();
  expect(second.claimable[0].claimed).toBe(true);
  const after = await (await page.request.get(`/api/tokens/${id}`)).json();
  expect(BigInt(after.epochs[0].claimed)).toBe(BigInt(after.epochs[0].funded));
});

test("journey: ORBIT acquires treasury assets", async ({ page }) => {
  await connect(page);
  const id = await launch(page, "ORBIT");
  await accumulate(page, id);
  await executeAndVerify(page, id, "Deployed");
  const d = await (await page.request.get(`/api/tokens/${id}`)).json();
  const assets = Object.fromEntries(d.assets.map((a: { asset: string; amount: string }) => [a.asset, BigInt(a.amount)]));
  expect(assets.SOL).toBeGreaterThan(0n);
  expect(assets.USDC).toBeGreaterThan(0n);
  expect(assets.LST).toBeGreaterThan(0n);
  expect(assets.RESERVE).toBeGreaterThan(0n);
  expect(BigInt(d.treasuryValue)).toBeGreaterThan(0n);
  await expect(page.getByText("Treasury", { exact: true })).toBeVisible();
});

test("journey: graduation moves trading to the AMM and the destiny keeps executing", async ({ page }) => {
  await connect(page);
  const id = await launch(page, "PHOENIX", { graduation: 5 });
  await page.goto(`/coin/${id}`);
  await trade(page, "BUY", "6");
  const d = await (await page.request.get(`/api/tokens/${id}`)).json();
  expect(d.token.status).toBe("AMM");
  expect(d.pool.lp_locked).toBe(d.pool.lp_supply);
  expect(d.graduation.signature).toMatch(/^grad:/);
  await page.reload();
  await expect(page.getByText("Graduated", { exact: true })).toBeVisible();
  // trade on the AMM and execute a post-graduation buyback
  await trade(page, "BUY", "3");
  const t = await (await page.request.get(`/api/tokens/${id}`)).json();
  expect(t.trades[0].venue).toBe("AMM");
  await accumulate(page, id);
  await executeAndVerify(page, id, "on the AMM");
  const f = await (await page.request.get(`/api/tokens/${id}`)).json();
  const done = f.executions.filter((e: { status: string }) => e.status === "COMPLETED");
  expect(done.length).toBeGreaterThanOrEqual(1);
  expect(done.every((e: { venue: string }) => e.venue === "AMM")).toBe(true);
});

test("discovery, leaderboards and activity reflect verified state", async ({ page }) => {
  await page.goto("/coins?tab=PHOENIX");
  expect(await page.getByTestId("token-card").count()).toBeGreaterThanOrEqual(2);
  await page.goto("/coins?tab=graduated");
  expect(await page.getByTestId("token-card").count()).toBeGreaterThanOrEqual(1);
  await page.goto("/coins?q=GRAV");
  expect(await page.getByTestId("token-card").count()).toBeGreaterThanOrEqual(1);
  await page.goto("/leaderboards");
  await expect(page.getByText("Most tokens burned")).toBeVisible();
  await expect(page.locator("ol li").first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Protocol activity")).toBeVisible();
  await expect(page.getByText(/Phoenix burned/).first()).toBeVisible();
});

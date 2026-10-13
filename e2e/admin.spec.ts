import { test, expect } from "@playwright/test";

const ADDR_A = "11111111111111111111111111111111";               // system program (valid base58 32 bytes)
const ADDR_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";   // token program
const ADDR_C = "So11111111111111111111111111111111111111112";   // wrapped SOL mint
const ADDR_D = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";  // USDC mint

test.describe.configure({ mode: "serial" });

test("admin: login guards the console and rejects a wrong key", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  const r = await page.request.get("/api/admin/settings");
  expect(r.status()).toBe(401);
  await page.getByTestId("admin-key").fill("nope");
  await page.getByTestId("admin-login").click();
  await expect(page.locator("form [role=alert]")).toContainText("isn't right");
  await page.getByTestId("admin-key").fill("fate-admin");
  await page.getByTestId("admin-login").click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("score")).toBeVisible();
});

test("admin: validation blocks bad input, valid input raises readiness, export and preview work", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByTestId("admin-key").fill("fate-admin");
  await page.getByTestId("admin-login").click();
  await expect(page.getByTestId("score")).toBeVisible();
  // start from a known-incomplete configuration regardless of ledger state
  await page.request.put("/api/admin/settings", { data: { programId: "", rpcUrl: "", wsUrl: "", auditReportUrl: "", mainnetEnabled: false } });
  await page.reload();
  const before = Number((await page.getByTestId("score").innerText()).replace("%", ""));
  expect(before).toBeLessThan(100);

  // invalid address + invalid url are rejected with field errors
  await page.getByTestId("f-programId").fill("not-an-address");
  await page.getByTestId("f-rpcUrl").fill("ftp://bad");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText("attention");
  await expect(page.getByText("must be a base58 32-byte address")).toBeVisible();
  await expect(page.getByText("must start with http(s)://")).toBeVisible();

  // valid values
  await page.getByTestId("f-programId").fill(ADDR_A);
  await page.getByTestId("f-rpcUrl").fill("https://api.devnet.solana.com");
  await page.getByTestId("f-wsUrl").fill("wss://api.devnet.solana.com");
  await page.getByTestId("f-protocolAuthority").fill(ADDR_B);
  await page.getByTestId("f-protocolTreasury").fill(ADDR_C);
  await page.getByTestId("f-keeperWallet").fill(ADDR_D);
  await page.getByTestId("f-raydiumCpmmProgram").fill(ADDR_A);
  await page.getByTestId("f-pythSolUsdFeed").fill("0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d");
  await page.getByTestId("f-usdcMint").fill(ADDR_D);
  await page.getByTestId("f-lstMint").fill(ADDR_C);
  await page.getByTestId("f-metadataGateway").fill("https://gateway.irys.xyz");
  await page.getByTestId("f-metadataApiKey").fill("irys-secret-key-1234");
  await page.getByTestId("f-siteUrl").fill("https://fate.example");
  await page.getByTestId("f-supportEmail").fill("ops@fate.example");
  await page.getByTestId("f-docsUrl").fill("https://docs.fate.example");
  await page.getByTestId("f-auditReportUrl").fill("https://audits.example/fate.pdf");
  await page.getByTestId("f-launchDate").fill("2026-12-01");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText("Saved");
  const after = Number((await page.getByTestId("score").innerText()).replace("%", ""));
  expect(after).toBeGreaterThan(before);
  expect(after).toBe(100);
  // secret is masked on read-back, and the mainnet switch becomes available
  await expect(page.getByTestId("f-metadataApiKey")).toHaveValue(/•+1234$/);
  await expect(page.getByTestId("mainnet-switch")).toBeEnabled();
  await page.getByTestId("mainnet-switch").check();
  await expect(page.getByTestId("save-msg")).toContainText("Saved");

  // export carries the real secret and the flag
  const env = await (await page.request.get("/api/admin/export")).text();
  expect(env).toContain("METADATA_API_KEY=irys-secret-key-1234");
  expect(env).toContain("FATE_MAINNET_ENABLED=1");
  expect(env).toContain(`FATE_PROGRAM_ID=${ADDR_A}`);

  // preview mode shows the configured network on the public site, and can be exited
  await page.goto("/api/admin/preview?on=1");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("preview-banner")).toBeVisible();
  await expect(page.getByText("devnet preview").first()).toBeVisible();
  await page.goto("/api/admin/preview?off=1");
  await expect(page.getByTestId("preview-banner")).toHaveCount(0);
});

test("admin: operations tab cranks and lists coins", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByTestId("admin-key").fill("fate-admin");
  await page.getByTestId("admin-login").click();
  await page.getByRole("button", { name: "Operations" }).click();
  await expect(page.getByText("Keeper")).toBeVisible();
  await page.getByRole("button", { name: "Crank all" }).click();
  await expect(page.getByText(/Cranked \d+ coins/)).toBeVisible();
});

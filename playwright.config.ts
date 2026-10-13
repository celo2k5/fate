import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.FATE_BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1360, height: 900 },
    screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" },
  },
  reporter: [["list"], ["html", { open: "never" }]],
});

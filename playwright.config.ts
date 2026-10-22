import { defineConfig } from "@playwright/test";

// E2E_VIDEO=1 records each test at a watchable pace (test-results/<test>/video.webm).
const video = process.env.E2E_VIDEO === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: video ? 180_000 : 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4300",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: video ? { mode: "on", size: { width: 1440, height: 900 } } : "off",
    launchOptions: {
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      ...(video ? { slowMo: 350 } : {}),
    },
  },
});

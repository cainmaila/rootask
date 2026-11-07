import { defineConfig, devices } from "@playwright/test";

// 介面自動化測試（#51）：建置後的前端＋假 GitHub（e2e/server.mjs），不需要登入。
// 執行前要先 npm run build。
export default defineConfig({
  testDir: "e2e",
  // 假 GitHub 的狀態是共用的，依序執行，每個測試開頭重設
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/server.mjs",
    url: "http://localhost:4173/api/session",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 860 } } },
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});

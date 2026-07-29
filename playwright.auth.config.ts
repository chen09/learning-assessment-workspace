import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = "http://127.0.0.1:3108";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "auth-route.spec.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webBaseUrl,
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "auth-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "auth-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command:
      "npm run dev --workspace @learning-assessment/web -- --hostname 127.0.0.1 --port 3108",
    url: webBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

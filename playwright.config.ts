import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = "http://127.0.0.1:3107";
const apiBaseUrl = "http://127.0.0.1:8017";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "postgres-flow.spec.ts",
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
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command:
        "uv run --directory apps/api uvicorn app.main:app --host 127.0.0.1 --port 8017",
      url: `${apiBaseUrl}/healthz`,
      env: {
        APP_ENV: "test",
        CHILD_SESSION_SECRET: "playwright-local-session-secret-only",
        CORS_ORIGINS: JSON.stringify([webBaseUrl]),
        REPOSITORY_BACKEND: "memory",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "npm run dev --workspace @learning-assessment/web -- --hostname 127.0.0.1 --port 3107",
      url: webBaseUrl,
      env: {
        NEXT_PUBLIC_API_URL: apiBaseUrl,
        NEXT_PUBLIC_E2E_PARENT_TOKEN: "parent-fixture",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

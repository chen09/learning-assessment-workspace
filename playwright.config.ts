import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = "http://127.0.0.1:3107";
const apiBaseUrl = "http://127.0.0.1:8017";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [
    "auth-route.spec.ts",
    "postgres-flow.spec.ts",
    "hosted-flow.spec.ts",
  ],
  // The fixture API has one shared job queue. Keep each project's flows in
  // source order so one test cannot consume another test's grading job.
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webBaseUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      // Chrome on iPad uses WebKit, which cannot run through local Chrome.
      // This still exercises the handwriting flow with iPad viewport, touch
      // input and scale in our Chromium E2E environment.
      name: "ipad-chrome",
      testMatch: "core-flow.spec.ts",
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      // iPad Chrome is required by Apple to use WebKit. Keep this separate
      // from the Chromium touch simulation so a WebKit regression cannot hide
      // behind the desktop browser engine.
      name: "ipad-webkit",
      testMatch: "core-flow.spec.ts",
      grep: /parent creation reaches child grading and correction through the API/,
      use: { ...devices["iPad (gen 7)"], browserName: "webkit" },
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
